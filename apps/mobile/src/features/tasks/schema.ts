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
  property: z.object({ name: z.string() }).nullable(),
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
