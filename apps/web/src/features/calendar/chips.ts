import type { CalendarTask, ExpiredTask, Staff, TaskStatus } from '@/features/tasks/schema';
import type { PropertyNode, TreeRow } from '@/lib/property-tree';

import { barKind } from './bars';
import { monthBounds } from './dates';
import type { CalendarBooking } from './schema';

/**
 * The rules of the task chips (docs/f10-plan.md, 7.4, §2, §4). What a chip
 * says and where it goes are in `task-chips.tsx`; this module decides which
 * chips a cell has, how they are filtered, and when one warns.
 */

/** The calendar's status filter (§2): the spec's four words over nine statuses. */
export const STATUS_FILTERS = ['all', 'open', 'inWork', 'done'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** A chip's colour: the status filter's group it falls in. */
export type ChipTone = Exclude<StatusFilter, 'all'>;

/** `all`, `nobody`, or a person's id. */
export type AssigneeFilter = string;
export const ANY_ASSIGNEE = 'all';
export const NO_ASSIGNEE = 'nobody';

const TONE_STATUSES: Readonly<Record<ChipTone, readonly TaskStatus[]>> = {
  open: ['unassigned', 'assigned', 'accepted'],
  inWork: ['in_progress', 'paused', 'blocked'],
  done: ['done'],
};

/** Null for the statuses the default view does not draw (cancelled, expired). */
export function chipTone(status: TaskStatus): ChipTone | null {
  const tones = Object.keys(TONE_STATUSES) as ChipTone[];
  return tones.find((tone) => TONE_STATUSES[tone].includes(status)) ?? null;
}

/**
 * «Статус» acts on the live and the done only; the cancelled answer to their
 * switch and what never happened to its default (§2). The assignee filter
 * acts on all of them.
 */
export function matchesChipFilters(
  task: Pick<CalendarTask, 'status' | 'assignee_id'>,
  status: StatusFilter,
  assignee: AssigneeFilter,
): boolean {
  const tone = chipTone(task.status);
  const isStatusKept = status === 'all' || tone === null || tone === status;
  const isAssigneeKept =
    assignee === ANY_ASSIGNEE ||
    (assignee === NO_ASSIGNEE ? task.assignee_id === null : task.assignee_id === assignee);
  return isStatusKept && isAssigneeKept;
}

/**
 * The statuses the generator leaves alone when a booking moves or goes
 * (20260926160000: it moves and cancels `unassigned`, `assigned` and
 * `accepted`; a cleaning somebody has started stays where it is).
 */
const LEFT_BEHIND: readonly TaskStatus[] = ['in_progress', 'paused', 'blocked'];

type JudgedTask = Pick<
  CalendarTask,
  | 'type'
  | 'status'
  | 'reservation_id'
  | 'scheduled_date'
  | 'property_id'
  | 'pinned_arrival'
  | 'pinned_departure'
>;

/**
 * Do the booking's dates still say what the cleaning was put on? An unmoved
 * cleaning stands on its booking's departure. A moved one stands where the
 * manager put it, and holds while the booking keeps the dates it had at the
 * move (`pinned_*`, 20260926160000): its day differing from the departure is
 * the move itself, not a change.
 */
function isDatesChanged(task: JudgedTask, booking: CalendarBooking): boolean {
  if (task.pinned_departure === null) {
    return booking.departure_date !== task.scheduled_date;
  }
  return (
    booking.arrival_date !== task.pinned_arrival || booking.departure_date !== task.pinned_departure
  );
}

/**
 * Would the bookings layer have read this cleaning's booking, had it not
 * changed? The calendar reads the bookings of the months it shows, whole (§1),
 * and the cleaning's own month is one of them. An unmoved cleaning stands on
 * its departure, so its booking touches that month. A moved one may stand
 * across the turn of a month from its stay at the move; then a booking missing
 * from the layer may simply not have been read, and it is not judged.
 */
function isStayRead(task: JudgedTask): boolean {
  if (task.pinned_arrival === null || task.pinned_departure === null) {
    return true;
  }
  const { from, to } = monthBounds(task.scheduled_date.slice(0, 7));
  return task.pinned_arrival < to && task.pinned_departure >= from;
}

/**
 * A departure cleaning left behind by its booking (§2): the booking is gone,
 * has changed its dates, stands on another listing, or has become a block
 * that owes no cleaning. The dates are judged by `isDatesChanged`: against the
 * departure for a cleaning where the booking put it, against the booking as it
 * was at the move for one the manager moved.
 *
 * Judged only when the bookings are read (`null` until then), and only for a
 * cleaning somebody has started: one nobody has started is still the
 * generator's to move, and a mismatch there is its lag, or a bookings layer
 * older than the tasks just reread after a save. The row is judged loosely: a
 * cleaning from before 12.09 still stands on the listing of a booking of rooms.
 */
export function isBookingChanged(
  task: JudgedTask,
  bookings: ReadonlyMap<number, CalendarBooking> | null,
): boolean {
  if (
    bookings === null ||
    task.type !== 'cleaning' ||
    task.reservation_id === null ||
    !LEFT_BEHIND.includes(task.status)
  ) {
    return false;
  }
  const booking = bookings.get(task.reservation_id);
  if (booking === undefined) {
    return isStayRead(task);
  }
  if (isDatesChanged(task, booking) || barKind(booking) === 'block') {
    return true;
  }
  return (
    task.property_id !== booking.property_id &&
    !booking.rooms.some((room) => room.property_id === task.property_id)
  );
}

/** Earliest window first; a task without one after those that have one. */
function byWindow(a: CalendarTask, b: CalendarTask): number {
  if (a.time_from !== b.time_from) {
    if (a.time_from === null) {
      return 1;
    }
    if (b.time_from === null) {
      return -1;
    }
    return a.time_from.localeCompare(b.time_from);
  }
  return a.id.localeCompare(b.id);
}

/** The tasks of every row by day, each cell in window order. */
export function tasksByRowDay(
  tasks: readonly CalendarTask[],
): Map<number, Map<string, CalendarTask[]>> {
  const byRow = new Map<number, Map<string, CalendarTask[]>>();
  for (const task of [...tasks].sort(byWindow)) {
    const byDay = byRow.get(task.property_id) ?? new Map<string, CalendarTask[]>();
    byDay.set(task.scheduled_date, [...(byDay.get(task.scheduled_date) ?? []), task]);
    byRow.set(task.property_id, byDay);
  }
  return byRow;
}

function subtreeIds<T extends TreeRow>(node: PropertyNode<T>): number[] {
  return [node.row.id, ...node.children.flatMap((child) => subtreeIds(child))];
}

/**
 * The chips of one cell. A closed group folds its rooms' and parts' chips
 * into the listing's row (§3), in the same window order.
 */
export function cellTasks<T extends TreeRow>(
  node: PropertyNode<T>,
  day: string,
  byRowDay: ReadonlyMap<number, ReadonlyMap<string, readonly CalendarTask[]>>,
  isFolded: boolean,
): CalendarTask[] {
  const ids = isFolded ? subtreeIds(node) : [node.row.id];
  const found = ids.flatMap((id) => byRowDay.get(id)?.get(day) ?? []);
  return isFolded ? [...found].sort(byWindow) : [...found];
}

const DOTS_PER_CELL = 2;
/** A chip read in full needs about a week's column (§4: about 130 px). */
const FULL_CHIP_WIDTH = 130;
/**
 * A column narrower than a whole chip shows dots (§4: 30 days, about 30 px).
 * Columns stretch to the screen since 7.5b, and a chip squeezed below its
 * width read as its first letters (the branch preflight of 2026-09-27).
 */
const DOT_BELOW = FULL_CHIP_WIDTH;
/**
 * A compact chip is the status dot and a name (the owner's request of
 * 2026-09-26): half a week's column, so fifteen days still read a name.
 */
const COMPACT_CHIP_WIDTH = 64;
/** Compact, a column narrower than one compact chip shows dots. */
const COMPACT_DOT_BELOW = COMPACT_CHIP_WIDTH;

/** How a chip reads: in full, or the status and the person alone. */
export const CHIP_VIEWS = ['full', 'compact'] as const;
export type ChipView = (typeof CHIP_VIEWS)[number];

export function isChipView(value: unknown): value is ChipView {
  return CHIP_VIEWS.includes(value as ChipView);
}

export interface ChipCapacity {
  mode: 'dot' | 'full' | 'compact';
  count: number;
}

export function chipCapacity(dayWidth: number, view: ChipView = 'full'): ChipCapacity {
  if (view === 'compact') {
    return dayWidth < COMPACT_DOT_BELOW
      ? { mode: 'dot', count: DOTS_PER_CELL }
      : { mode: 'compact', count: Math.max(1, Math.floor(dayWidth / COMPACT_CHIP_WIDTH)) };
  }
  return dayWidth < DOT_BELOW
    ? { mode: 'dot', count: DOTS_PER_CELL }
    : { mode: 'full', count: Math.max(1, Math.floor(dayWidth / FULL_CHIP_WIDTH)) };
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/**
 * People on the chips who are not among the active staff (§1): switched off
 * since. The assignee filter lists them apart, marked, so their chips can
 * still be found.
 */
export function offListAssignees(
  tasks: readonly CalendarTask[],
  staff: readonly Staff[],
): { id: string; name: string | null }[] {
  const active = new Set(staff.map((person) => person.id));
  const found = new Map<string, string | null>();
  for (const task of tasks) {
    if (task.assignee_id !== null && !active.has(task.assignee_id)) {
      // An id is not a name: a nameless person reads «Без имени», not a UUID.
      found.set(task.assignee_id, task.assignee?.full_name ?? found.get(task.assignee_id) ?? null);
    }
  }
  return [...found]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => collator.compare(a.name ?? '', b.name ?? ''));
}

/**
 * One mark per cleaning that never happened (§2): the same key as the
 * generator's guard (20260918171000) — the booking, the listing, the day.
 * The copies are a trace of the old bug, not information, so no «×11». A
 * task written by hand has no key and is never folded: two on one day are
 * two tasks. The first row by id stands for its key.
 */
export function collapseExpired(rows: readonly ExpiredTask[]): ExpiredTask[] {
  const seen = new Set<string>();
  // A copy that names a person stands for its key before one that names
  // nobody: the person who held the cleaning is what the mark should say.
  const byStanding = (a: ExpiredTask, b: ExpiredTask) =>
    Number(a.assignee_id === null) - Number(b.assignee_id === null) || a.id.localeCompare(b.id);
  return [...rows]
    .sort(byStanding)
    .filter((row) => {
      if (row.type !== 'cleaning' || row.reservation_id === null) {
        return true;
      }
      const key = `${row.reservation_id}:${row.property_id}:${row.scheduled_date}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.id.localeCompare(b.id));
}

/**
 * A mark as a chip. The row is narrow (§1); the chip needs a place's name
 * when a closed group folds it, and the person's name for its words — both
 * from what the calendar already holds. The drawer reads the task whole.
 */
export function expiredAsTask(
  row: ExpiredTask,
  placeName: (propertyId: number) => string | undefined,
  personName: (personId: string) => string | undefined,
): CalendarTask {
  const name = placeName(row.property_id);
  const person =
    row.assignee_id === null
      ? undefined
      : (row.assignee?.full_name ?? personName(row.assignee_id) ?? undefined);
  return {
    ...row,
    problem_id: null,
    status: 'expired',
    priority: 0,
    created_by: null,
    time_from: null,
    time_to: null,
    started_at: null,
    completed_at: null,
    measured_minutes: null,
    duration_override_min: null,
    is_parallel: false,
    is_short_measurement: null,
    notes: null,
    title: null,
    title_i18n: null,
    created_at: row.scheduled_date,
    pinned_arrival: null,
    pinned_departure: null,
    property:
      name === undefined ? null : { name, hostaway_unit_id: null, timezone: null, parent: null },
    assignee: person === undefined ? null : { full_name: person, role: null },
    problem: null,
  };
}
