import { supabase } from '@/lib/supabase';

import {
  boardProblemListSchema,
  staffListSchema,
  type BoardProblem,
  type StaffMember,
} from './schema';

/**
 * A task as the board shows it: its status and archive stamp, the place with
 * the house above a room, and its repairs with who holds each, the day and the
 * hours. No people embedded: profiles are closed to the head technician, and
 * names come from `staff_directory` (20261003120000).
 */
const BOARD_COLUMNS =
  'id, property_id, title, priority, status, archived_at, created_at, ' +
  'property:properties(name, hostaway_unit_id, parent:parent_id(name)), ' +
  'fix_tasks:tasks!tasks_problem_id_fkey(id, type, assignee_id, status, scheduled_date, time_from, time_to)';

/**
 * Every task of the company, newest first. Row level security draws the line:
 * for the head technician that is all of them, the archive too (decisions 7
 * and 15).
 */
export async function fetchBoardProblems(): Promise<BoardProblem[]> {
  const { data, error } = await supabase
    .from('problems')
    .select(BOARD_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return boardProblemListSchema.parse(data ?? []);
}

/** One task as the board reads it, for the dispatch on its screen; null when there is none. */
export async function fetchBoardProblem(problemId: string): Promise<BoardProblem | null> {
  const { data, error } = await supabase.from('problems').select(BOARD_COLUMNS).eq('id', problemId);

  if (error) {
    throw error;
  }

  return boardProblemListSchema.parse(data ?? [])[0] ?? null;
}

/** The company's people by name and role — nothing for anybody but him and the manager. */
export async function fetchStaffDirectory(): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc('staff_directory');

  if (error) {
    throw error;
  }

  return staffListSchema.parse(data ?? []);
}

export interface AssignProblemVariables {
  problemId: string;
  assigneeId: string;
  /** `YYYY-MM-DD`, the day chosen on the sheet. */
  scheduledDate: string;
  /** The hours the live repair already has, sent back as they are; null for none. */
  timeFrom: string | null;
  timeTo: string | null;
}

/**
 * Hand the task to a technician for a day (assign_problem, 20261003130000).
 * The server answers with the task, which nobody reads: the screens fetch
 * again, as they would after any move of the office.
 */
export async function assignProblem(variables: AssignProblemVariables): Promise<void> {
  const { error } = await supabase.rpc('assign_problem', {
    p_id: variables.problemId,
    p_assignee_id: variables.assigneeId,
    p_scheduled_date: variables.scheduledDate,
    p_time_from: variables.timeFrom ?? undefined,
    p_time_to: variables.timeTo ?? undefined,
  });

  if (error) {
    throw error;
  }
}

export interface UnassignProblemVariables {
  taskId: string;
  /**
   * Who the screen showed on the repair. A repair that holds somebody else by
   * now is refused (`taskChangedMeanwhile`): nobody is taken off whom the
   * head technician never saw on it.
   */
  expectedAssigneeId: string;
}

/** Take the person off the repair: it is cancelled, and the task waits again. */
export async function unassignProblem(variables: UnassignProblemVariables): Promise<void> {
  const { error } = await supabase.rpc('unassign_problem', {
    p_task_id: variables.taskId,
    p_expected_assignee: variables.expectedAssigneeId,
  });

  if (error) {
    throw error;
  }
}
