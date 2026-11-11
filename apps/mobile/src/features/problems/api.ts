import { readGuestOrigin, type GuestOrigin } from '@str-ops/shared';

import { supabase } from '@/lib/supabase';

import { CLOSING_COLUMNS } from './closing';
import { GUEST_SIGNAL_SOURCE_COLUMNS } from './signal-source';
import { problemListSchema, problemSchema, type Problem, type ProblemPriority } from './schema';

const PROBLEM_COLUMNS =
  'id, property_id, task_id, reported_by, title, ' +
  GUEST_SIGNAL_SOURCE_COLUMNS +
  'description, priority, status, ' +
  CLOSING_COLUMNS +
  'resolved_at, cancelled_at, cancel_reason, created_at, property:properties(name, hostaway_unit_id, parent:parent_id(name)), ' +
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

/**
 * The keys of the answer the phone shows. The PMS's numbers and the signal are
 * the office's, for the panel: whoever is signed in, the phone draws none.
 */
function phoneOrigin(origin: GuestOrigin): GuestOrigin {
  const { source, stay, channel, guest, rating, sent } = origin;
  return { source, stay, channel, guest, rating, sent };
}

/**
 * Where a task from a guest came from, as this person may know it
 * (problem_guest_origin, 20261111120000): the stay for everybody who may read
 * the task, the guest's name, the channel and the day it was sent for the head
 * technician — the server decides by role. Null for a report of the staff and
 * for a task that is not hers to read. Read field by field: an odd value costs
 * its line, not the screen.
 */
export async function fetchGuestOrigin(problemId: string): Promise<GuestOrigin | null> {
  const { data, error } = await supabase.rpc('problem_guest_origin', {
    p_problem_id: problemId,
  });

  if (error) {
    throw error;
  }

  const origin = readGuestOrigin(data);
  return origin === null ? null : phoneOrigin(origin);
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
