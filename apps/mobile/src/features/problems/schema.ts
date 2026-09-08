import { z } from 'zod';

export const PROBLEM_PRIORITIES = ['low', 'normal', 'high'] as const;
export type ProblemPriority = (typeof PROBLEM_PRIORITIES)[number];

export const PROBLEM_STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'cancelled'] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** The same numbers the database checks (problem_*_max_length, problem_max_photos). */
export const MAX_PROBLEM_TITLE = 200;
export const MAX_PROBLEM_DESCRIPTION = 4000;
export const MAX_PROBLEM_PHOTOS = 4;

/**
 * A problem as the app reads it. The listing name rides along from the join;
 * a row straight from an RPC has no join, so it is optional.
 */
export const problemSchema = z.object({
  id: z.string().uuid(),
  property_id: z.number().nullable(),
  task_id: z.string().uuid().nullable(),
  reported_by: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(PROBLEM_PRIORITIES),
  status: z.enum(PROBLEM_STATUSES),
  resolved_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  created_at: z.string(),
  property: z.object({ name: z.string().nullable() }).nullable().optional(),
  // The fix tasks the reader may see — for a technician, her own.
  fix_tasks: z
    .array(
      z.object({
        id: z.string().uuid(),
        assignee_id: z.string().uuid().nullable(),
        status: z.string(),
      }),
    )
    .default([]),
});

export type Problem = z.infer<typeof problemSchema>;

/** The live fix task that is the reader's own, if any. */
export function ownFixTaskId(problem: Problem, userId: string | null): string | null {
  return (
    problem.fix_tasks.find(
      (task) =>
        task.assignee_id === userId && task.status !== 'cancelled' && task.status !== 'expired',
    )?.id ?? null
  );
}
export const problemListSchema = z.array(problemSchema);

/** What the form holds before it becomes a row. */
export interface ProblemDraft {
  title: string;
  description: string;
  priority: ProblemPriority;
}

export const EMPTY_PROBLEM_DRAFT: ProblemDraft = { title: '', description: '', priority: 'normal' };

export type ProblemDraftIssue = 'titleRequired' | 'titleTooLong' | 'descriptionTooLong';

/** Why the draft cannot be sent yet, mirroring the server's refusals, or null. */
export function problemDraftIssue(draft: ProblemDraft): ProblemDraftIssue | null {
  if (draft.title.trim() === '') {
    return 'titleRequired';
  }
  if (draft.title.trim().length > MAX_PROBLEM_TITLE) {
    return 'titleTooLong';
  }
  if (draft.description.length > MAX_PROBLEM_DESCRIPTION) {
    return 'descriptionTooLong';
  }
  return null;
}

export function draftOfProblem(problem: Problem): ProblemDraft {
  return {
    title: problem.title,
    description: problem.description ?? '',
    priority: problem.priority,
  };
}

/** The reporter may change the report until somebody picks it up. */
export function canEditProblem(problem: Problem, userId: string | null): boolean {
  return problem.status === 'open' && problem.reported_by === userId;
}

export function isProblemClosed(problem: Problem): boolean {
  return problem.status === 'resolved' || problem.status === 'cancelled';
}

export interface ProblemGroup {
  key: 'active' | 'closed';
  data: Problem[];
}

/** Live reports first, closed ones below, each newest first as the server sends them. */
export function groupProblems(problems: readonly Problem[]): ProblemGroup[] {
  const active = problems.filter((problem) => !isProblemClosed(problem));
  const closed = problems.filter(isProblemClosed);

  return [
    ...(active.length > 0 ? [{ key: 'active' as const, data: active }] : []),
    ...(closed.length > 0 ? [{ key: 'closed' as const, data: closed }] : []),
  ];
}
