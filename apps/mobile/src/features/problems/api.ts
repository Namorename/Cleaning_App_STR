import { readGuestOrigin, type GuestOrigin } from '@str-ops/shared';

import { supabase } from '@/lib/supabase';

import { problemCategoryListSchema, type ProblemCategory } from './categories';
import { CLOSING_COLUMNS } from './closing';
import { GUEST_SIGNAL_SOURCE_COLUMNS } from './signal-source';
import { problemListSchema, problemSchema, type Problem, type ProblemPriority } from './schema';

const PROBLEM_COLUMNS =
  'id, property_id, task_id, reported_by, title, ' +
  GUEST_SIGNAL_SOURCE_COLUMNS +
  'description, priority, critical, category_id, status, ' +
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

/**
 * The company's catalogue of categories, in its own order (problem_categories,
 * 20261115100000). The read policy answers with the reader's own company;
 * archived categories are no longer offered.
 */
export async function fetchProblemCategories(): Promise<ProblemCategory[]> {
  const { data, error } = await supabase
    .from('problem_categories')
    .select('id, name, name_i18n, synonyms, priority, critical')
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  return problemCategoryListSchema.parse(data ?? []);
}

export interface ReportProblemVariables {
  /** Made on the phone, so a retry after a lost connection is a replay, not a duplicate. */
  problemId: string;
  title: string;
  description: string;
  /** As the server stores it: a critical task is `high` here, with `critical`. */
  priority: ProblemPriority;
  /**
   * The level above high (20261115090000). Absent from a report a build before
   * it queued on the phone: the server then files it as it did.
   */
  critical?: boolean;
  taskId?: string | null;
  propertyId?: number | null;
  /**
   * The category she picked. The server then names the task and sets its
   * urgency from the category, whatever title and priority say. Absent from a
   * report a build before the catalogue queued on the phone.
   */
  categoryId?: string | null;
}

/** File the report. Replayable by id: the server hands the same row back. */
export async function reportProblem(variables: ReportProblemVariables): Promise<Problem> {
  const { data, error } = await supabase.rpc('report_problem', {
    p_id: variables.problemId,
    p_title: variables.title,
    p_description: variables.description === '' ? undefined : variables.description,
    p_priority: variables.priority,
    p_critical: variables.critical,
    p_property_id: variables.propertyId ?? undefined,
    p_task_id: variables.taskId ?? undefined,
    p_category_id: variables.categoryId ?? undefined,
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
  /**
   * True or false says so; absent — a correction a build before the level
   * queued — keeps the flag while the priority stays high.
   */
  critical?: boolean;
  /** Another category she picked; absent keeps the one the task has, if any. */
  categoryId?: string | null;
}

/** Correct the report while it is still open. */
export async function updateProblem(variables: UpdateProblemVariables): Promise<Problem> {
  const { data, error } = await supabase.rpc('update_problem', {
    p_id: variables.problemId,
    p_title: variables.title,
    p_description: variables.description === '' ? undefined : variables.description,
    p_priority: variables.priority,
    p_critical: variables.critical,
    p_category_id: variables.categoryId ?? undefined,
  });

  if (error) {
    throw error;
  }

  return problemSchema.parse(data);
}
