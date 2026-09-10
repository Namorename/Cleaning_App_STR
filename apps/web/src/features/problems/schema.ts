import { z } from 'zod';

export const PROBLEM_PRIORITIES = ['low', 'normal', 'high'] as const;
export type ProblemPriority = (typeof PROBLEM_PRIORITIES)[number];

export const PROBLEM_STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'cancelled'] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** The board's columns, left to right; cancelled problems live in the list only. */
export const BOARD_STATUSES = ['open', 'assigned', 'in_progress', 'resolved'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** Task statuses that no longer count as an attempt at the fix. */
const CLOSED_TASK_STATUSES = ['done', 'cancelled', 'expired'] as const;

const personSchema = z
  .object({ full_name: z.string().nullable(), role: z.string().nullable().default(null) })
  .nullable();

/** The fix task as the manager reads it, with the technician's name along. */
export const fixTaskSchema = z.object({
  id: z.uuid(),
  assignee_id: z.uuid().nullable(),
  status: z.string(),
  scheduled_date: z.string(),
  time_from: z.string().nullable(),
  time_to: z.string().nullable(),
  assignee: personSchema.optional(),
});
export type FixTask = z.infer<typeof fixTaskSchema>;

/**
 * A problem as the panel reads it: the row plus the names it needs to show.
 * A row straight from an RPC carries no joins, so they are optional.
 */
export const problemSchema = z.object({
  id: z.uuid(),
  property_id: z.number().nullable(),
  task_id: z.uuid().nullable(),
  reported_by: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(PROBLEM_PRIORITIES),
  status: z.enum(PROBLEM_STATUSES),
  resolved_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  /** Set when the manager put the problem away; it is then off the board and the list. */
  archived_at: z.string().nullable().default(null),
  created_at: z.string(),
  property: z.object({ name: z.string() }).nullable().optional(),
  reporter: personSchema.optional(),
  fix_tasks: z.array(fixTaskSchema).default([]),
});
export type Problem = z.infer<typeof problemSchema>;
export const problemListSchema = z.array(problemSchema);

/** A photo attached to a problem or to a step of its fix task. */
export const mediaSchema = z.object({
  id: z.uuid(),
  step_id: z.uuid().nullable(),
  storage_path: z.string(),
  created_at: z.string(),
});
export type Media = z.infer<typeof mediaSchema>;
export const mediaListSchema = z.array(mediaSchema);

/** A step of the fix task, as snapshotted when the technician started it. */
export const taskStepSchema = z.object({
  id: z.uuid(),
  sort_order: z.number(),
  type: z.string(),
  required: z.boolean(),
  title: z.string().nullable(),
  title_i18n: z.record(z.string(), z.string()).nullable().catch(null),
  completed_at: z.string().nullable(),
  skipped_at: z.string().nullable(),
  waived_at: z.string().nullable(),
});
export type TaskStep = z.infer<typeof taskStepSchema>;
export const taskStepListSchema = z.array(taskStepSchema);

/** Somebody a problem can be handed to. */
export const staffSchema = z.object({
  id: z.uuid(),
  full_name: z.string().nullable(),
  role: z.string(),
});
export type Staff = z.infer<typeof staffSchema>;
export const staffListSchema = z.array(staffSchema);

/** The fix attempt that is still alive, if any. The database keeps at most one. */
export function liveFixTask(problem: Pick<Problem, 'fix_tasks'>): FixTask | null {
  return (
    problem.fix_tasks.find(
      (task) => !(CLOSED_TASK_STATUSES as readonly string[]).includes(task.status),
    ) ?? null
  );
}

export function isProblemClosed(problem: Pick<Problem, 'status'>): boolean {
  return problem.status === 'resolved' || problem.status === 'cancelled';
}

export function isProblemArchived(problem: Pick<Problem, 'archived_at'>): boolean {
  return problem.archived_at !== null;
}

/** Title or listing name contains the query, case-insensitively; an empty query keeps everything. */
export function matchesQuery(problem: Problem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') {
    return true;
  }
  const haystack = [problem.title, problem.property?.name ?? ''].join(' ').toLocaleLowerCase();
  return haystack.includes(needle);
}

/**
 * What dropping a card into a column means.
 *
 * `assign` opens the technician form, `resolve` asks first, `unassign`
 * cancels the technician's task so the problem is open again, `reopen` takes
 * a resolved problem back to "open". `startOnPhone` is the column only the
 * technician can fill. Null: nothing to do.
 */
export type BoardMove = 'assign' | 'resolve' | 'unassign' | 'reopen' | 'startOnPhone' | null;

export function boardMove(from: ProblemStatus, to: BoardStatus): BoardMove {
  if (from === to || from === 'cancelled') {
    return null;
  }
  if (from === 'resolved') {
    return to === 'open' ? 'reopen' : null;
  }
  switch (to) {
    case 'open':
      return 'unassign';
    case 'assigned':
      return from === 'open' ? 'assign' : null;
    case 'in_progress':
      return 'startOnPhone';
    case 'resolved':
      return 'resolve';
  }
}

/** A card the manager may pick up at all: a resolved one only to reopen it. */
export function isDraggable(problem: Pick<Problem, 'status'>): boolean {
  return problem.status !== 'cancelled';
}

export type StepState = 'done' | 'skipped' | 'waived' | 'pending';

export function stepState(
  step: Pick<TaskStep, 'completed_at' | 'skipped_at' | 'waived_at'>,
): StepState {
  if (step.completed_at !== null) {
    return 'done';
  }
  if (step.waived_at !== null) {
    return 'waived';
  }
  if (step.skipped_at !== null) {
    return 'skipped';
  }
  return 'pending';
}
