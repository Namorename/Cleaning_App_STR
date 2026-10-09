import { z } from 'zod';

/**
 * One row of a task's journal (`problem_events`, 20261003140000): what kind of
 * event, who did it — null for the system, or a person since deleted — when,
 * and its parameters: ids, days, hours, statuses, never text. The kind is read
 * as any string, so an event a newer server writes is a line, not a failure of
 * the whole history; parameters of a shape this build does not expect read as
 * none.
 */
export const problemEventSchema = z.object({
  id: z.number(),
  problem_id: z.string().uuid(),
  task_id: z.string().uuid().nullable().default(null),
  kind: z.string(),
  actor_id: z.string().uuid().nullable().default(null),
  created_at: z.string(),
  params: z.record(z.string(), z.unknown()).catch({}),
});

export type ProblemEvent = z.infer<typeof problemEventSchema>;

export const problemEventListSchema = z.array(problemEventSchema);

/**
 * The day the journal began: the server part went out on 2026-10-03
 * (docs/launch-phone-plan.md §3), and the past was not reconstructed
 * (docs/tech-plan.md §3.1). A task older than that has no beginning here.
 */
export const JOURNAL_START = '2026-10-03';

/** The event every task written since the rollout begins with. */
export const FIRST_EVENT = 'reported';
