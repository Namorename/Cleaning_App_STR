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
      // Access codes and quirks of the flat, written by the office for her.
      cleaner_notes: z.string().nullable().default(null),
    })
    .nullable(),
  // The window the cleaning has to fit into: when the departing guest actually
  // leaves, and when the next one may arrive. Postgres serialises a time with
  // seconds ("10:00:00"); it is kept as it comes and trimmed for display.
  time_from: z.string().nullable(),
  time_to: z.string().nullable(),
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

/** What the cleaner holding the phone may do with this task right now. */
export type TaskAction = 'claim' | 'start' | 'finish';

export function availableAction(task: CleaningTask, userId: string): TaskAction | null {
  if (isFree(task)) {
    return 'claim';
  }
  if (task.assignee_id !== userId) {
    return null;
  }
  if (task.status === 'assigned') {
    return 'start';
  }
  if (task.status === 'in_progress') {
    return 'finish';
  }
  return null;
}

export type TaskGroupKey = 'running' | 'upcoming';

export interface TaskGroup {
  key: TaskGroupKey;
  data: CleaningTask[];
}

/**
 * The cleaner's own list, with everything under way first.
 *
 * Several cleanings run at once on a floor, and switching between them is the
 * whole point of the list — so the running ones are a group of their own at
 * the top, never one highlighted row. An empty group is left out: a heading
 * with nothing under it reads as something missing.
 */
export function groupMyTasks(tasks: readonly CleaningTask[]): TaskGroup[] {
  const running = tasks.filter(isRunning);
  const upcoming = tasks.filter((task) => !isRunning(task));

  return [
    { key: 'running' as const, data: running },
    { key: 'upcoming' as const, data: upcoming },
  ].filter((group) => group.data.length > 0);
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
 * Earliest scheduled date still worth showing in the free queue.
 *
 * Built from the device's local calendar date rather than from an instant:
 * `scheduled_date` is a calendar date in the listing's timezone, and the
 * cleaner's phone is in that timezone.
 */
export function earliestClaimableDate(now: Date = new Date()): string {
  const earliest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - CLAIM_GRACE_DAYS);
  const month = String(earliest.getMonth() + 1).padStart(2, '0');
  const day = String(earliest.getDate()).padStart(2, '0');

  return `${earliest.getFullYear()}-${month}-${day}`;
}
