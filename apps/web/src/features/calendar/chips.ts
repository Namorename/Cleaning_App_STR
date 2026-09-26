import type { CalendarTask, ExpiredTask, Staff, TaskStatus } from '@/features/tasks/schema';
import type { PropertyNode, TreeRow } from '@/lib/property-tree';

import { barKind } from './bars';
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
 * (20260926102000: it moves and cancels only `unassigned` and `assigned`).
 */
const LEFT_BEHIND: readonly TaskStatus[] = ['accepted', 'in_progress', 'paused', 'blocked'];

/**
 * A departure cleaning left behind by its booking (§2): the booking is gone,
 * leaves on another day, stands on another listing, or has become a block
 * that owes no cleaning.
 *
 * Judged only when the bookings are read (`null` until then), and only for a
 * cleaning somebody has taken: one nobody has taken is still the generator's
 * to move, and a mismatch there is its lag, or a bookings layer older than
 * the tasks just reread after a save. The row is judged loosely: a cleaning
 * from before 12.09 still stands on the listing of a booking of rooms.
 */
export function isBookingChanged(
  task: Pick<CalendarTask, 'type' | 'status' | 'reservation_id' | 'scheduled_date' | 'property_id'>,
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
  if (
    booking === undefined ||
    booking.departure_date !== task.scheduled_date ||
    barKind(booking) === 'block'
  ) {
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

/** A column this narrow shows dots, not chips (§4: 30 days, about 30 px). */
const DOT_BELOW = 100;
const DOTS_PER_CELL = 2;
/** A chip read in full needs about a week's column (§4: about 130 px). */
const FULL_CHIP_WIDTH = 130;
/**
 * A compact chip is the status dot and a name (the owner's request of
 * 2026-09-26): half a week's column, so fifteen days still read a name.
 */
const COMPACT_CHIP_WIDTH = 64;
/** Compact, only thirty days' columns are too narrow for a name. */
const COMPACT_DOT_BELOW = 48;

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
    property:
      name === undefined ? null : { name, hostaway_unit_id: null, timezone: null, parent: null },
    assignee: person === undefined ? null : { full_name: person, role: null },
    problem: null,
  };
}
