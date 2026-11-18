import { supabase } from '@/lib/supabase';

/**
 * The manager's levers on a task (problem), as the panel pulls them
 * (apps/web/src/features/problems/api.ts). Each server function takes the
 * task through `problem_for_manager` — a manager's or an admin's, refused to
 * anybody else (`serverErrors.managerOnly`) — and answers with the row, which
 * nobody reads: the screens read the task again.
 */
export type ProblemAction =
  /** Closed as done by hand, naming who did the work; null: nobody, the manager alone. */
  | { kind: 'resolve'; problemId: string; completedBy: string | null }
  /** Cancelled with its live repair; the reason may stay unsaid. */
  | { kind: 'cancel'; problemId: string; reason: string | null }
  /** A resolved or cancelled task open again; its closed repair stays as history. */
  | { kind: 'reopen'; problemId: string }
  /** Off every screen but the archive; nothing is deleted, a live repair is cancelled. */
  | { kind: 'archive'; problemId: string }
  | { kind: 'unarchive'; problemId: string };

export type ProblemActionKind = ProblemAction['kind'];

function resolveArgs(problemId: string, completedBy: string | null) {
  // Naming nobody is said as «alone»; saying neither is the old panel's «not stated».
  return completedBy === null
    ? { p_id: problemId, p_alone: true }
    : { p_id: problemId, p_completed_by: completedBy };
}

function send(action: ProblemAction) {
  switch (action.kind) {
    case 'resolve':
      return supabase.rpc('resolve_problem', resolveArgs(action.problemId, action.completedBy));
    case 'cancel':
      return supabase.rpc('cancel_problem', {
        p_id: action.problemId,
        p_reason: action.reason ?? undefined,
      });
    case 'reopen':
      return supabase.rpc('reopen_problem', { p_id: action.problemId });
    case 'archive':
      return supabase.rpc('archive_problem', { p_id: action.problemId });
    case 'unarchive':
      return supabase.rpc('unarchive_problem', { p_id: action.problemId });
  }
}

export async function runProblemAction(action: ProblemAction): Promise<void> {
  const { error } = await send(action);

  if (error) {
    throw error;
  }
}
