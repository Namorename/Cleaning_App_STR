import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import { withSignedUrls } from '@/lib/media';

import {
  mediaListSchema,
  problemListSchema,
  problemSchema,
  staffListSchema,
  taskStepListSchema,
  type Media,
  type Problem,
  type Staff,
  type TaskStep,
} from './schema';

export type Client = SupabaseClient<Database>;

const PROBLEM_COLUMNS =
  'id, property_id, task_id, reported_by, title, description, priority, status, ' +
  'resolved_at, cancelled_at, cancel_reason, archived_at, created_at, ' +
  'property:properties(name), ' +
  'reporter:profiles!problems_reported_by_fkey(full_name), ' +
  'fix_tasks:tasks!tasks_problem_id_fkey(id, assignee_id, status, scheduled_date, time_from, time_to, ' +
  'assignee:profiles!tasks_assignee_id_fkey(full_name))';

/** Every problem of the company, newest first. Row level security draws the line. */
export async function fetchProblems(client: Client): Promise<Problem[]> {
  const { data, error } = await client
    .from('problems')
    .select(PROBLEM_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) {
    throw error;
  }
  return problemListSchema.parse(data ?? []);
}

/** One problem for its card. Null when there is no such row to see. */
export async function fetchProblem(client: Client, problemId: string): Promise<Problem | null> {
  const { data, error } = await client
    .from('problems')
    .select(PROBLEM_COLUMNS)
    .eq('id', problemId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? null : problemSchema.parse(data);
}

export interface Photo extends Media {
  /** A signed link, or null when storage refused to sign this path. */
  url: string | null;
}

/** The report's own photos, oldest first, with links to open them. */
export async function fetchProblemPhotos(client: Client, problemId: string): Promise<Photo[]> {
  const { data, error } = await client
    .from('task_media')
    .select('id, step_id, storage_path, created_at')
    .eq('problem_id', problemId)
    .is('deleted_at', null)
    .not('uploaded_at', 'is', null)
    .order('created_at', { ascending: true });
  if (error) {
    throw error;
  }
  return withSignedUrls(client, mediaListSchema.parse(data ?? []));
}

export interface FixTaskSteps {
  steps: TaskStep[];
  /** The photos the technician took, keyed by the step they belong to. */
  photosByStep: Record<string, Photo[]>;
}

/** The snapshot of steps the fix task carries, with the photos taken on each. */
export async function fetchFixTaskSteps(client: Client, taskId: string): Promise<FixTaskSteps> {
  const [stepsResult, mediaResult] = await Promise.all([
    client
      .from('task_steps')
      .select(
        'id, sort_order, type, required, title, title_i18n, completed_at, skipped_at, waived_at',
      )
      .eq('task_id', taskId)
      .order('sort_order', { ascending: true }),
    client
      .from('task_media')
      .select('id, step_id, storage_path, created_at')
      .eq('task_id', taskId)
      .is('deleted_at', null)
      .not('uploaded_at', 'is', null)
      .order('created_at', { ascending: true }),
  ]);
  if (stepsResult.error) {
    throw stepsResult.error;
  }
  if (mediaResult.error) {
    throw mediaResult.error;
  }

  const photos = await withSignedUrls(client, mediaListSchema.parse(mediaResult.data ?? []));
  const photosByStep = photos.reduce<Record<string, Photo[]>>((groups, photo) => {
    if (photo.step_id === null) {
      return groups;
    }
    return { ...groups, [photo.step_id]: [...(groups[photo.step_id] ?? []), photo] };
  }, {});

  return { steps: taskStepListSchema.parse(stepsResult.data ?? []), photosByStep };
}

/** Active people of the company a problem can be handed to. */
export async function fetchStaff(client: Client): Promise<Staff[]> {
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, role')
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (error) {
    throw error;
  }
  return staffListSchema.parse(data ?? []);
}

export interface AssignProblemVariables {
  problemId: string;
  assigneeId: string;
  /** `YYYY-MM-DD`; the listing's today when omitted. */
  scheduledDate: string | null;
  /** `HH:MM`, both optional. */
  timeFrom: string | null;
  timeTo: string | null;
}

export async function assignProblem(
  client: Client,
  variables: AssignProblemVariables,
): Promise<Problem> {
  const { data, error } = await client.rpc('assign_problem', {
    p_id: variables.problemId,
    p_assignee_id: variables.assigneeId,
    p_scheduled_date: variables.scheduledDate ?? undefined,
    p_time_from: variables.timeFrom ?? undefined,
    p_time_to: variables.timeTo ?? undefined,
  });
  if (error) {
    throw error;
  }
  return problemSchema.parse(data);
}

export async function cancelProblem(
  client: Client,
  problemId: string,
  reason: string,
): Promise<Problem> {
  const { data, error } = await client.rpc('cancel_problem', {
    p_id: problemId,
    p_reason: reason.trim() === '' ? undefined : reason.trim(),
  });
  if (error) {
    throw error;
  }
  return problemSchema.parse(data);
}

/**
 * Take the fix away from the technician: the live task is cancelled, and the
 * database's mirror puts the problem back to 'open'. A manager writes tasks
 * under row level security; there is no RPC for this on purpose.
 */
export async function unassignProblem(client: Client, taskId: string): Promise<void> {
  const { error } = await client.from('tasks').update({ status: 'cancelled' }).eq('id', taskId);
  if (error) {
    throw error;
  }
}

export async function resolveProblem(client: Client, problemId: string): Promise<Problem> {
  const { data, error } = await client.rpc('resolve_problem', { p_id: problemId });
  if (error) {
    throw error;
  }
  return problemSchema.parse(data);
}

/** A resolved or cancelled problem goes back to "open"; its closed task stays as history. */
export async function reopenProblem(client: Client, problemId: string): Promise<Problem> {
  const { data, error } = await client.rpc('reopen_problem', { p_id: problemId });
  if (error) {
    throw error;
  }
  return problemSchema.parse(data);
}

/** Off every screen but the archive. Nothing is deleted; a live fix task is cancelled. */
export async function archiveProblem(client: Client, problemId: string): Promise<Problem> {
  const { data, error } = await client.rpc('archive_problem', { p_id: problemId });
  if (error) {
    throw error;
  }
  return problemSchema.parse(data);
}

export async function unarchiveProblem(client: Client, problemId: string): Promise<Problem> {
  const { data, error } = await client.rpc('unarchive_problem', { p_id: problemId });
  if (error) {
    throw error;
  }
  return problemSchema.parse(data);
}
