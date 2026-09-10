import { z } from 'zod';

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

const personSchema = z.object({ full_name: z.string().nullable() }).nullable();

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
  property: z.object({ name: z.string() }).nullable().optional(),
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

/** A listing the manager can put a task on. */
export const propertySchema = z.object({ id: z.number(), name: z.string() });
export type Property = z.infer<typeof propertySchema>;
export const propertyListSchema = z.array(propertySchema);

/** A problem reported while this task was being done. */
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

/** Its day has passed and it is still open — the manager needs to see it today. */
export function isOverdue(task: Pick<Task, 'status' | 'scheduled_date'>, today: string): boolean {
  return !isTaskClosed(task) && task.scheduled_date < today;
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
}

export const EMPTY_FILTERS: TaskFilters = { query: '', assigneeId: 'all', type: 'all' };

/** Title, listing or executor contains the query; an empty query keeps everything. */
export function matchesQuery(task: Task, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') {
    return true;
  }
  const haystack = [
    task.title ?? '',
    task.property?.name ?? '',
    task.assignee?.full_name ?? '',
    task.notes ?? '',
  ]
    .join(' ')
    .toLocaleLowerCase();
  return haystack.includes(needle);
}

export function matchesFilters(task: Task, filters: TaskFilters): boolean {
  if (filters.type !== 'all' && task.type !== filters.type) {
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
 * translated, `day` is a `YYYY-MM-DD` and is formatted as a date.
 */
export interface TaskGroup {
  key: string;
  kind: 'time' | 'day';
  tasks: Task[];
}

/** Earliest window first; a task with no window closes the group. */
function byTime(left: Task, right: Task): number {
  if (left.time_from === right.time_from) {
    return (left.property?.name ?? '').localeCompare(right.property?.name ?? '');
  }
  if (left.time_from === null) {
    return 1;
  }
  if (right.time_from === null) {
    return -1;
  }
  return left.time_from.localeCompare(right.time_from);
}

/**
 * Today's work reads as a day: morning, then afternoon, then evening. The
 * other tabs span days, so there the day itself is the heading — nearest
 * first when the work is ahead, most recent first when it is behind.
 */
export function groupTasks(tasks: Task[], tab: TaskTab): TaskGroup[] {
  if (tab === 'today') {
    return TIME_GROUPS.map((key) => ({
      key,
      kind: 'time' as const,
      tasks: tasks.filter((task) => timeGroup(task) === key).sort(byTime),
    })).filter((group) => group.tasks.length > 0);
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

/** What the manager fills in for a new task, or changes on an existing one. */
export interface TaskDraft {
  id: string;
  propertyId: number | null;
  type: TaskType;
  scheduledDate: string;
  title: string;
  /** Language code to text, for the languages the manager chose to fill in. */
  titleI18n: Record<string, string>;
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
    titleI18n: task.title_i18n ?? {},
    assigneeId: task.assignee_id,
    timeFrom: task.time_from === null ? null : task.time_from.slice(0, 5),
    timeTo: task.time_to === null ? null : task.time_to.slice(0, 5),
    notes: task.notes ?? '',
  };
}

/**
 * Is the draft worth sending? Only what the panel can see for itself — the
 * server checks the rest and says so in the reader's language.
 */
export function isDraftReady(draft: TaskDraft): boolean {
  return draft.propertyId !== null && draft.title.trim() !== '' && draft.scheduledDate.trim() !== '';
}
