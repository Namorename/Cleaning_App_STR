import { supabase } from '@/lib/supabase';

import { problemListSchema, problemSchema, type Problem, type ProblemPriority } from './schema';

const PROBLEM_COLUMNS =
  'id, property_id, task_id, reported_by, title, description, priority, status, ' +
  'resolved_at, cancelled_at, cancel_reason, created_at, property:properties(name), ' +
  'fix_tasks:tasks!tasks_problem_id_fkey(id, assignee_id, status)';

/**
 * The problems this person may see: her own reports, and the ones she has
 * been handed to fix. Row level security draws that line; no filter here.
 */
export async function fetchMyProblems(): Promise<Problem[]> {
  const { data, error } = await supabase
    .from('problems')
    .select(PROBLEM_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return problemListSchema.parse(data ?? []);
}

/** One problem, for its own screen. Null when it is not hers to see. */
export async function fetchProblem(problemId: string): Promise<Problem | null> {
  const { data, error } = await supabase
    .from('problems')
    .select(PROBLEM_COLUMNS)
    .eq('id', problemId);

  if (error) {
    throw error;
  }

  const rows = problemListSchema.parse(data ?? []);
  return rows[0] ?? null;
}

export interface ReportProblemVariables {
  /** Made on the phone, so a retry after a lost connection is a replay, not a duplicate. */
  problemId: string;
  title: string;
  description: string;
  priority: ProblemPriority;
  taskId?: string | null;
  propertyId?: number | null;
}

/** File the report. Replayable by id: the server hands the same row back. */
export async function reportProblem(variables: ReportProblemVariables): Promise<Problem> {
  const { data, error } = await supabase.rpc('report_problem', {
    p_id: variables.problemId,
    p_title: variables.title,
    p_description: variables.description === '' ? undefined : variables.description,
    p_priority: variables.priority,
    p_property_id: variables.propertyId ?? undefined,
    p_task_id: variables.taskId ?? undefined,
  });

  if (error) {
    throw error;
  }

  return problemSchema.parse(data);
}

export interface UpdateProblemVariables {
  problemId: string;
  title: string;
  description: string;
  priority: ProblemPriority;
}

/** Correct the report while it is still open. */
export async function updateProblem(variables: UpdateProblemVariables): Promise<Problem> {
  const { data, error } = await supabase.rpc('update_problem', {
    p_id: variables.problemId,
    p_title: variables.title,
    p_description: variables.description === '' ? undefined : variables.description,
    p_priority: variables.priority,
  });

  if (error) {
    throw error;
  }

  return problemSchema.parse(data);
}
