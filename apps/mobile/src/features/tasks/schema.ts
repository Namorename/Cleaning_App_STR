import { Constants } from '@str-ops/shared';
import { z } from 'zod';

/**
 * Shape of a cleaning task as the app reads it.
 *
 * Validated at the boundary rather than trusted: the generated database types
 * describe what the schema promises, not what actually arrived over the wire.
 * A renamed column or a nullable that turned out to be null shows up here as a
 * clear parse error instead of an undefined halfway down a screen.
 */
export const cleaningTaskSchema = z.object({
  id: z.string().uuid(),
  status: z.enum([
    'unassigned',
    'assigned',
    'accepted',
    'in_progress',
    'paused',
    'blocked',
    'done',
    'cancelled',
    // Terminal: the day passed and the cleaning never happened. Kept as
    // history, never offered for work.
    'expired',
  ]),
  priority: z.number().int(),
  scheduled_date: z.string(),
  due_at: z.string().nullable(),
  assignee_id: z.string().uuid().nullable(),
  property_id: z.number(),
  property: z
    .object({
      name: z.string(),
      // The street she drives to. A room inherits it from its listing, so it
      // is filled whether the cleaning stands on the building or in it.
      // Defaulted for a row cached before the column was asked for.
      address: z.string().nullable().default(null),
      // Access codes and quirks of the flat, written by the office for her.
      effective_cleaner_notes: z.string().nullable().default(null),
      // Set on a room of a multi-unit listing, and only there. It is what
      // separates a room from a part of a combined listing — both are children
      // under `parent_id`, and only the first is a piece of its parent.
      hostaway_unit_id: z.number().nullable().default(null),
      // The listing a room belongs to. Null when the cleaning stands on the
      // listing itself — then `name` already names the house. A room's own
      // name ("1 - 2109", "Unit 3 - 7013") never does.
      parent: z.object({ name: z.string() }).nullable().default(null),
    })
    .nullable(),
  // The window the cleaning has to fit into: when the departing guest actually
  // leaves, and when the next one may arrive. Postgres serialises a time with
  // seconds ("10:00:00"); it is kept as it comes and trimmed for display.
  time_from: z.string().nullable(),
  time_to: z.string().nullable(),
  // Every kind the office can create, straight from the database enum: a kind
  // missing here failed the whole list and blanked her day. Defaulted for a
  // row cached before F9 — the readers run cached rows through this schema.
  type: z.enum(Constants.public.Enums.task_type).default('cleaning'),
  // The office's words on this job — on a fix, the report's description. A
  // process with a task-note step carries them as a step once the task starts;
  // before that, and on an inspection or a midstay without a process, this is
  // the only way they reach her. Defaulted for a row cached before the column
  // was asked for.
  notes: z.string().nullable().default(null),
  // What the office called the job, in the company's language, with its
  // translations. Set on work made by hand in the panel; the panel names the
  // job by it and falls back to the kind, and so does the phone. Defaulted for
  // a row cached before the columns were asked for.
  title: z.string().nullable().default(null),
  title_i18n: z.record(z.string(), z.string()).catch({}).default({}),
  // The booking the job follows. Null on work the office made by hand in the
  // panel: nobody checks in after it, and nobody decided that nobody does —
  // its priority 0 says nothing about arrivals. Optional rather than
  // defaulted: a row cached before the column was asked for has no key, and
  // that means "not known", not "no booking" — reading it as null would strip
  // the check-in from a turnover she is looking at offline.
  reservation_id: z.number().nullable().optional(),
  // Set on a maintenance task: the report it fixes.
  problem: z
    .object({
      id: z.string().uuid(),
      title: z.string(),
      priority: z.enum(['low', 'normal', 'high']),
    })
    .nullable()
    .optional(),
  // Guests of the ARRIVING booking — how many sets of linen, in practice.
  guests_count: z.number().int().nullable(),
  // Stamped by the database when she starts and finishes; never sent by us.
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  // Overlapped another of her cleanings. Shown so a long measurement is not
  // mistaken for a slow one.
  is_parallel: z.boolean(),
});

export type CleaningTask = z.infer<typeof cleaningTaskSchema>;

export const cleaningTaskListSchema = z.array(cleaningTaskSchema);

/** Priority 1 means the next guest arrives the same day. */
export function isSameDayTurnover(task: CleaningTask): boolean {
  return task.priority >= 1;
}

export function isFree(task: CleaningTask): boolean {
  return task.status === 'unassigned' && task.assignee_id === null;
}

export function isRunning(task: CleaningTask): boolean {
  return task.status === 'in_progress';
}

/** What the cleaner holding the phone may do with this task. */
export type TaskAction = 'claim' | 'accept' | 'start' | 'finish';

/**
 * Every move the server would let her make, in the order the screen offers
 * them.
 *
 * An assigned cleaning offers two: accepting is a signal to the office, not
 * a step before the start, and a cleaner who forgot to tap it must still be
 * able to work at the door (owner's decision 5, F11). Whether the start is
 * open yet is the window's business (`canStartNow`), not this list's.
 */
export function availableActions(task: CleaningTask, userId: string): readonly TaskAction[] {
  if (isFree(task)) {
    return ['claim'];
  }
  if (task.assignee_id !== userId) {
    return [];
  }
  switch (task.status) {
    case 'assigned':
      return ['accept', 'start'];
    case 'accepted':
      return ['start'];
    case 'in_progress':
      return ['finish'];
    default:
      return [];
  }
}

/**
 * A section of a list of cleanings: the work under way, or one planned day.
 * A day's `key` is its `scheduled_date`, which is what the heading is read from.
 */
export type TaskGroup =
  | { readonly kind: 'running'; readonly key: 'running'; readonly data: CleaningTask[] }
  | { readonly kind: 'day'; readonly key: string; readonly data: CleaningTask[] }
  // «Выполненные» below her open list (owner, 2026-10-10): read on demand.
  | { readonly kind: 'done'; readonly key: 'done'; readonly data: CleaningTask[] };

/**
 * One section per planned day, the nearest first.
 *
 * The day is `scheduled_date` as it came: a calendar date at the listing,
 * which is where the phone is — the same reading as `earliestClaimableDate`.
 * Inside a day the rows keep the order the server gave them (the same-day
 * check-in first); the list is grouped, not re-sorted. A day with nothing on
 * it gets no section.
 */
export function groupByDay(tasks: readonly CleaningTask[]): TaskGroup[] {
  const days = [...new Set(tasks.map((task) => task.scheduled_date))].sort();

  return days.map((day) => ({
    kind: 'day' as const,
    key: day,
    data: tasks.filter((task) => task.scheduled_date === day),
  }));
}

/**
 * The cleaner's own list: everything under way first, then her days.
 *
 * Several cleanings run at once on a floor, and switching between them is the
 * whole point of the list — so the running ones are a section of their own at
 * the top, whatever day they were planned for, never one highlighted row.
 * Nothing under way, no such section: a heading with nothing under it reads
 * as something missing.
 */
export function groupMyTasks(tasks: readonly CleaningTask[]): TaskGroup[] {
  const running = tasks.filter(isRunning);
  const days = groupByDay(tasks.filter((task) => !isRunning(task)));

  return running.length === 0
    ? days
    : [{ kind: 'running' as const, key: 'running' as const, data: running }, ...days];
}

/**
 * How long after its day a cleaning can still be taken.
 *
 * Mirrors `public.task_grace_days()` in the database, which is the authority:
 * the claim is refused there whatever this constant says. It exists so the
 * queue does not offer a card that the server is going to reject — between
 * midnight and the nightly sweep such tasks are still 'unassigned'.
 */
export const CLAIM_GRACE_DAYS = 1;

/**
 * The phone's calendar date, `days` away from `now`, in the shape
 * `scheduled_date` has.
 *
 * Built from the device's local calendar date rather than from an instant:
 * `scheduled_date` is a calendar date in the listing's timezone, and the
 * cleaner's phone is in that timezone.
 */
export function calendarDay(now: Date, days = 0): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/** Earliest scheduled date still worth showing in the free queue. */
export function earliestClaimableDate(now: Date = new Date()): string {
  return calendarDay(now, -CLAIM_GRACE_DAYS);
}

/**
 * The moment the cleaning may start: the scheduled date at the window's start,
 * or midnight of that date when the start is unknown.
 *
 * Built in the phone's local time, like `earliestClaimableDate`: the window is
 * a clock time at the listing, and the phone is at the listing. The server
 * judges the same rule in the listing's timezone and refuses an early start;
 * this mirror only keeps the button honest.
 */
export function startNotBefore(task: CleaningTask): Date {
  const [year, month, day] = task.scheduled_date.split('-').map(Number);
  const [hours, minutes] = (task.time_from ?? '00:00').split(':').map(Number);

  return new Date(year, month - 1, day, hours, minutes);
}

export function canStartNow(task: CleaningTask, now: Date): boolean {
  return now.getTime() >= startNotBefore(task).getTime();
}
