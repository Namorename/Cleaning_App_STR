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
