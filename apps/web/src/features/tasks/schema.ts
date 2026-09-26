import { propertyPath, propertyPathOf, splitPlace, type PlaceParts } from '@str-ops/shared';
import { z } from 'zod';

import { todayIn } from '@/lib/format-date';
import { matchesAllTokens } from '@/lib/search';

export const TASK_TYPES = ['cleaning', 'midstay', 'maintenance', 'inspection'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = [
  'unassigned',
  'assigned',
  'accepted',
  'in_progress',
  'paused',
  'blocked',
  'done',
  'cancelled',
  'expired',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Statuses that mean nobody is going to do this any more. */
const CLOSED_STATUSES: readonly TaskStatus[] = ['done', 'cancelled', 'expired'];

/**
 * The three tabs, in the order the manager works them: what is happening
 * now (today, and anything overdue that never happened), what is coming,
 * and what is behind us.
 */
export const TASK_TABS = ['today', 'upcoming', 'closed'] as const;
export type TaskTab = (typeof TASK_TABS)[number];

const personSchema = z
  .object({ full_name: z.string().nullable(), role: z.string().nullable().default(null) })
  .nullable();

/** A task as the panel reads it: the row plus the names it needs to show. */
export const taskSchema = z.object({
  id: z.uuid(),
  property_id: z.number(),
  reservation_id: z.number().nullable(),
  problem_id: z.uuid().nullable(),
  type: z.enum(TASK_TYPES),
  status: z.enum(TASK_STATUSES),
  priority: z.number().default(0),
  assignee_id: z.uuid().nullable(),
  created_by: z.uuid().nullable().default(null),
  scheduled_date: z.string(),
  time_from: z.string().nullable(),
  time_to: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  measured_minutes: z.number().nullable(),
  duration_override_min: z.number().nullable(),
  is_parallel: z.boolean().default(false),
  is_short_measurement: z.boolean().nullable().default(null),
  notes: z.string().nullable(),
  title: z.string().nullable().default(null),
  title_i18n: z.record(z.string(), z.string()).nullable().catch(null),
  created_at: z.string(),
  property: z
    .object({
      name: z.string(),
      // Set on a room of a multi-unit listing, and only there — the same test
      // `propertyOptions` uses. A part of a combined listing is also a child
      // under `parent_id`, and it is a listing with its own calendar.
      hostaway_unit_id: z.number().nullable().default(null),
      // The property's own zone: "yesterday" is counted by the property's
      // calendar, as the server's grace rule counts it (`tailOf`). Missing,
      // the browser's day stands in.
      timezone: z.string().nullable().optional(),
      // The listing a room belongs to. Null when the task stands on the
      // listing itself — then `name` is already the building's. A room's own
      // name ("1 - 2109") never says which building it is in.
      parent: z.object({ name: z.string() }).nullable().default(null),
    })
    .nullable()
    .optional(),
  assignee: personSchema.optional(),
  author: personSchema.optional(),
});
export type Task = z.infer<typeof taskSchema>;
export const taskListSchema = z.array(taskSchema);

/** Somebody a task can be handed to. */
export const staffSchema = z.object({
  id: z.uuid(),
  full_name: z.string().nullable(),
  role: z.string(),
});
export type Staff = z.infer<typeof staffSchema>;
export const staffListSchema = z.array(staffSchema);

/**
 * A listing the manager can put a task on, or one of its rooms.
 *
 * Nine listings hold rooms, and since the cleanings moved onto the rooms the
 * field has to be able to name one. `hostaway_unit_id` is what says which is
 * which — `parent_id` also carries the combined-listing relationship, whose
 * children are real listings with their own calendars.
 */
export const propertySchema = z.object({
  id: z.number(),
  name: z.string(),
  parent_id: z.number().nullable().default(null),
  hostaway_unit_id: z.number().nullable().default(null),
});
export type Property = z.infer<typeof propertySchema>;
export const propertyListSchema = z.array(propertySchema);

/** What stands between a building and a room in one line of text. */

/** One line of the listing field. */
export interface PropertyOption {
  id: number;
  name: string;
}

/**
 * The building a property belongs to, and the room within it if it is one.
 *
 * This list holds flat rows and resolves the parent through a map, so it
 * cannot hand the shared labeller a joined row directly — it builds one. The
 * roomness test itself is not repeated here: `splitPlace` owns it.
 *
 * `?? null` on the lookup is what keeps the orphan case. A room whose listing
 * is not in the list should not happen — the status cascade takes rooms with
 * their listing — but dropping it would blank the flat field of every task
 * standing on it, which is the defect this list exists to prevent.
 */
function splitOptionPlace(property: Property, byId: Map<number, Property>): PlaceParts {
  const parent = property.parent_id === null ? null : (byId.get(property.parent_id) ?? null);
  return splitPlace({
    name: property.name,
    hostaway_unit_id: property.hostaway_unit_id,
    parent: parent === null ? null : { name: parent.name },
  });
}

/**
 * The listings and rooms a task can be put on, as the field should read them.
 *
 * A room is named by its building and itself. Its own name — "1 - 2109",
 * "Unit 3 - 7013" — never says which building it is in, and a closed select
 * shows nothing but the chosen option's own text, so a heading above it would
 * answer the question only while the list is open.
 *
 * Rooms follow their own listing, and the listing stays pickable: a repair in
 * the hallway belongs to the building rather than to any one flat.
 */
export function propertyOptions(properties: Property[]): PropertyOption[] {
  const byId = new Map(properties.map((property) => [property.id, property]));
  return properties
    .map((property) => ({ property, ...splitOptionPlace(property, byId) }))
    .sort(
      (left, right) =>
        left.building.localeCompare(right.building) ||
        (left.room === null ? 0 : 1) - (right.room === null ? 0 : 1) ||
        (left.room ?? '').localeCompare(right.room ?? ''),
    )
    .map(({ property, building, room }) => ({
      id: property.id,
      name: propertyPath(building, room),
    }));
}

/**
 * The flat a task stands on, in one line: the building, and the room inside it
 * when the cleaning stands on a room.
 *
 * Nine listings hold rooms, and a cleaning of one stands on the room the guest
 * slept in. The row's own name is then "1 - 2109" — which labels a card with
 * something no manager can place, and leaves a search for the house finding
 * none of its cleanings. The parent listing is joined onto every task for
 * exactly this, and this is where the two become one name.
 *
 * A child that is not a room keeps its own name: `parent_id` also links a part
 * of a combined listing, which is a listing with its own calendar and its own
 * guests, and naming it after its neighbour would be simply wrong. The test is
 * `hostaway_unit_id`, the same one `splitPlace` makes above.
 *
 * Null when the listing was not joined: the caller decides what to show
 * instead, and a task always has `property_id` whatever this returns.
 */
export function taskPropertyName(task: Pick<Task, 'property'>): string | null {
  return propertyPathOf(task.property ?? null);
}

/** A problem reported while this task was being done. */
/**
 * The booking a generated cleaning closes: its Hostaway id and who is leaving.
 * Read for the task's form only — the list does not carry guests' names.
 */
export const departureGuestSchema = z.object({
  id: z.number(),
  guest_name: z.string().nullable(),
});
export type DepartureGuest = z.infer<typeof departureGuestSchema>;

export const taskProblemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.string(),
  created_at: z.string(),
});
export type TaskProblem = z.infer<typeof taskProblemSchema>;
export const taskProblemListSchema = z.array(taskProblemSchema);

export function isTaskClosed(task: Pick<Task, 'status'>): boolean {
  return CLOSED_STATUSES.includes(task.status);
}

/** Written by a person, rather than generated from a booking or a report. */
export function isManualTask(task: Pick<Task, 'reservation_id' | 'problem_id'>): boolean {
  return task.reservation_id === null && task.problem_id === null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) / DAY_MS;
}

/** How many days a live task has been hanging past its own day. */
export interface TaskTail {
  days: number;
}

/**
 * A live task whose day is already behind the property's own today. The
 * usual one is yesterday's cleaning in its grace day — still allowed, still
 * the manager's to chase — and it stays in the Today tab, marked. The day is
 * counted in the property's zone, as the server's grace rule counts it: a
 * manager elsewhere must not see a tail the server does not.
 */
export function tailOf(
  task: Pick<Task, 'status' | 'scheduled_date' | 'property'>,
  now: Date = new Date(),
): TaskTail | null {
  if (isTaskClosed(task)) {
    return null;
  }
  const today = todayIn(task.property?.timezone, now);
  if (task.scheduled_date >= today) {
    return null;
  }
  return { days: dayNumber(today) - dayNumber(task.scheduled_date) };
}

/** How long it took, the manager's correction winning over the measurement. */
export function taskMinutes(
  task: Pick<Task, 'measured_minutes' | 'duration_override_min'>,
): number | null {
  return task.duration_override_min ?? task.measured_minutes;
}

export function tabOf(task: Pick<Task, 'status' | 'scheduled_date'>, today: string): TaskTab {
  if (isTaskClosed(task)) {
    return 'closed';
  }
  return task.scheduled_date > today ? 'upcoming' : 'today';
}

/** What the filter bar holds. `all` means the filter is off. */
export interface TaskFilters {
  query: string;
  /** A person's id, `all`, or `nobody` for the queue of unassigned work. */
  assigneeId: string;
  type: TaskType | 'all';
  /** `YYYY-MM-DD`, both ends inclusive; an empty string is an open end. */
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_FILTERS: TaskFilters = {
  query: '',
  assigneeId: 'all',
  type: 'all',
  dateFrom: '',
  dateTo: '',
};

/** Is any filter on? What an empty list should say depends on it. */
export function hasFilters(filters: TaskFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.assigneeId !== 'all' ||
    filters.type !== 'all' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== ''
  );
}

/**
 * Title, listing or executor contains every word of the query; an empty query
 * keeps everything.
 *
 * The listing here is the whole flat — building and room — because a manager
 * looking for the work in a house types the name of the house, and the
 * cleanings of that house now stand on its rooms. Every word rather than one
 * substring for the same reason: the flat reads "CZ - Vinohradska Royal —
 * 1 - 2109", and "vinohradska 2109" is what a person types after seeing it.
 */
export function matchesQuery(task: Task, query: string): boolean {
  const haystack = [
    task.title ?? '',
    taskPropertyName(task) ?? '',
    task.assignee?.full_name ?? '',
    task.notes ?? '',
  ].join(' ');
  return matchesAllTokens(haystack, query);
}

export function matchesFilters(task: Task, filters: TaskFilters): boolean {
  if (filters.type !== 'all' && task.type !== filters.type) {
    return false;
  }
  // `YYYY-MM-DD` sorts as it reads, so a string compare is a date compare.
  if (filters.dateFrom !== '' && task.scheduled_date < filters.dateFrom) {
    return false;
  }
  if (filters.dateTo !== '' && task.scheduled_date > filters.dateTo) {
    return false;
  }
  if (filters.assigneeId === 'nobody' && task.assignee_id !== null) {
    return false;
  }
  if (
    filters.assigneeId !== 'all' &&
    filters.assigneeId !== 'nobody' &&
    task.assignee_id !== filters.assigneeId
  ) {
    return false;
  }
  return matchesQuery(task, filters.query);
}

/**
 * The parts of a day work is grouped into.
 *
 * `anytime` is not a fourth part of the day but the absence of one: a task
 * with no window is done whenever the cleaner gets to it, and it belongs at
 * the end rather than pretending to a time it does not have.
 */
export const TIME_GROUPS = ['morning', 'afternoon', 'evening', 'anytime'] as const;
export type TimeGroup = (typeof TIME_GROUPS)[number];

const AFTERNOON_FROM_HOUR = 12;
const EVENING_FROM_HOUR = 17;

export function timeGroup(task: Pick<Task, 'time_from'>): TimeGroup {
  if (task.time_from === null) {
    return 'anytime';
  }
  const hour = Number(task.time_from.slice(0, 2));
  if (Number.isNaN(hour)) {
    return 'anytime';
  }
  if (hour >= EVENING_FROM_HOUR) {
    return 'evening';
  }
  return hour >= AFTERNOON_FROM_HOUR ? 'afternoon' : 'morning';
}

/**
 * A heading with the tasks under it.
 *
 * `kind` says how to read the key: `time` is one of TIME_GROUPS and is
 * translated, `day` is a `YYYY-MM-DD` and is formatted as a date, `tail` is
 * the Today tab's work left over from earlier days.
 */
export interface TaskGroup {
  key: string;
  kind: 'time' | 'day' | 'tail';
  tasks: Task[];
}

/**
 * Earliest window first; a task with no window closes the group.
 *
 * Equal windows are settled by the flat — building first, then the room in it,
 * which is what `taskPropertyName` composes. Sorting by the row's own name
 * instead would interleave the rooms of different houses under one heading.
 */
function byTime(left: Task, right: Task): number {
  if (left.time_from === right.time_from) {
    return (taskPropertyName(left) ?? '').localeCompare(taskPropertyName(right) ?? '');
  }
  if (left.time_from === null) {
    return 1;
  }
  if (right.time_from === null) {
    return -1;
  }
  return left.time_from.localeCompare(right.time_from);
}

/** The oldest day first — the longest overdue is the first to chase. */
function byDayThenTime(left: Task, right: Task): number {
  return left.scheduled_date === right.scheduled_date
    ? byTime(left, right)
    : left.scheduled_date.localeCompare(right.scheduled_date);
}

/**
 * Today's work reads as a day: morning, then afternoon, then evening. What is
 * left over from earlier days goes above all of it, in a group of its own —
 * spread over the parts of the day, a tail stood among today's work and was
 * found only by its border. A tail is what `tailOf` says, with the same `now`
 * the cards get, so the heading and the border never disagree.
 *
 * The other tabs span days, so there the day itself is the heading — nearest
 * first when the work is ahead, most recent first when it is behind.
 */
export function groupTasks(tasks: Task[], tab: TaskTab, now: Date): TaskGroup[] {
  if (tab === 'today') {
    const tails = tasks.filter((task) => tailOf(task, now) !== null);
    const current = tasks.filter((task) => tailOf(task, now) === null);
    const tailGroup: TaskGroup = { key: 'tail', kind: 'tail', tasks: tails.sort(byDayThenTime) };
    const timeGroups = TIME_GROUPS.map((key) => ({
      key,
      kind: 'time' as const,
      tasks: current.filter((task) => timeGroup(task) === key).sort(byTime),
    }));
    return [tailGroup, ...timeGroups].filter((group) => group.tasks.length > 0);
  }

  const days = [...new Set(tasks.map((task) => task.scheduled_date))].sort((left, right) =>
    tab === 'closed' ? right.localeCompare(left) : left.localeCompare(right),
  );
  return days.map((day) => ({
    key: day,
    kind: 'day' as const,
    tasks: tasks.filter((task) => task.scheduled_date === day).sort(byTime),
  }));
}

/** The title in the manager's language, falling back to the company's words. */
export function localizedTitle(
  task: Pick<Task, 'title' | 'title_i18n'>,
  language: string,
): string | null {
  const translated = task.title_i18n?.[language];
  return translated !== undefined && translated.trim() !== '' ? translated : task.title;
}

/**
 * What the manager fills in for a new task, or changes on an existing one.
 *
 * One title, in the company's own language, and it may be left blank — a job
 * is usually "cleaning, flat 3, Friday" and needs no name of its own. The
 * translations column is not here: the form does not offer one, and a save
 * that says nothing about translations leaves whatever is stored alone.
 */
export interface TaskDraft {
  id: string;
  propertyId: number | null;
  type: TaskType;
  scheduledDate: string;
  title: string;
  assigneeId: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  notes: string;
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    id: task.id,
    propertyId: task.property_id,
    type: task.type,
    scheduledDate: task.scheduled_date,
    title: task.title ?? '',
    assigneeId: task.assignee_id,
    timeFrom: task.time_from === null ? null : task.time_from.slice(0, 5),
    timeTo: task.time_to === null ? null : task.time_to.slice(0, 5),
    notes: task.notes ?? '',
  };
}

/**
 * The kinds that are somebody's job from the moment they are written.
 *
 * The owner's decision: an inspection or a maintenance job left to nobody is
 * one nobody does — nobody is shown it, and it expires unnoticed. A cleaning
 * may still wait in the queue. The panel holds this line on its own:
 * `save_task` still accepts an unassigned task of any kind.
 */
const TYPES_NEEDING_ASSIGNEE: readonly TaskType[] = ['inspection', 'maintenance'];

export function needsAssignee(type: TaskType): boolean {
  return TYPES_NEEDING_ASSIGNEE.includes(type);
}

/** A kind that needs somebody, with nobody named — the gap the form points at. */
export function isAssigneeMissing(draft: Pick<TaskDraft, 'type' | 'assigneeId'>): boolean {
  return needsAssignee(draft.type) && draft.assigneeId === null;
}

/**
 * Is the draft worth sending? Only what the panel can see for itself — the
 * server checks the rest and says so in the reader's language. The title is
 * not among them: a task without one is called by its kind.
 */
export function isDraftReady(draft: TaskDraft): boolean {
  return (
    draft.propertyId !== null && draft.scheduledDate.trim() !== '' && !isAssigneeMissing(draft)
  );
}
