import type { TaskStatus } from '@str-ops/shared';

import { i18n } from '@/i18n';
import { supabase } from '@/lib/supabase';

import { cleaningTaskListSchema, earliestClaimableDate, type CleaningTask } from './schema';

// The joined listing name is what the cleaner actually recognises; the numeric
// id means nothing to her. Notes ride along: the code for the key box is the
// first thing she needs at the door.
const TASK_COLUMNS =
  'id, status, priority, scheduled_date, due_at, assignee_id, property_id, ' +
  'time_from, time_to, guests_count, started_at, completed_at, is_parallel, ' +
  'property:properties(name, cleaner_notes)';

// `satisfies` ties the list to the database enum: a status renamed in a
// migration becomes a type error here instead of a filter that silently
// matches nothing.
const OPEN_STATUSES = [
  'unassigned',
  'assigned',
  'accepted',
  'in_progress',
  'paused',
  'blocked',
] as const satisfies readonly TaskStatus[];

/**
 * Tasks already belonging to this cleaner.
 *
 * Row level security would hide other people's work anyway; filtering by
 * assignee here is what separates "mine" from the queue, not a security
 * measure.
 */
export async function fetchMyTasks(cleanerId: string): Promise<CleaningTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('type', 'cleaning')
    .eq('assignee_id', cleanerId)
    .in('status', OPEN_STATUSES)
    .order('scheduled_date', { ascending: true })
    .order('priority', { ascending: false });

  if (error) {
    throw error;
  }

  return cleaningTaskListSchema.parse(data ?? []);
}

/**
 * Free tasks on the listings this cleaner is linked to.
 *
 * The link itself is enforced by row level security: an unassigned task on a
 * listing she does not clean is simply not in the result.
 *
 * The date filter is courtesy, not enforcement. Work past its grace period is
 * refused by the server whatever this query asks for; the nightly sweep closes
 * it as 'expired' a few hours later. Between the two, this keeps the queue
 * from offering a card that cannot be taken.
 *
 * There is deliberately no filter for the far end. The seven-day horizon lives
 * in the row policies, so tasks beyond it never reach the client at all —
 * mirroring the number here would only create something to drift.
 */
export async function fetchFreeTasks(): Promise<CleaningTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('type', 'cleaning')
    .eq('status', 'unassigned')
    .is('assignee_id', null)
    .gte('scheduled_date', earliestClaimableDate())
    .order('scheduled_date', { ascending: true })
    .order('priority', { ascending: false });

  if (error) {
    throw error;
  }

  return cleaningTaskListSchema.parse(data ?? []);
}

/** One task, for its own screen. Null when it is not hers to see any more. */
export async function fetchTask(taskId: string): Promise<CleaningTask | null> {
  const { data, error } = await supabase.from('tasks').select(TASK_COLUMNS).eq('id', taskId);

  if (error) {
    throw error;
  }

  const rows = cleaningTaskListSchema.parse(data ?? []);
  return rows[0] ?? null;
}

/**
 * Move a task from one status to the next.
 *
 * The `status` filter on the update is what makes every move safe against a
 * stale screen and against two taps: an update that no longer matches the
 * expected status touches no row, and the caller is told rather than left to
 * believe it worked. The server refuses moves it disallows — a second start
 * with parallel work switched off, a finish without a start — with an error
 * that arrives as `error`, and stamps the clock itself: nothing about the
 * time is sent from here.
 */
async function moveTask(
  taskId: string,
  from: TaskStatus,
  patch: { status: TaskStatus; assignee_id?: string },
  failureKey: string,
): Promise<CleaningTask> {
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', taskId)
    .eq('status', from)
    .select(TASK_COLUMNS);

  if (error) {
    throw error;
  }

  const moved = cleaningTaskListSchema.parse(data ?? []);
  if (moved.length === 0) {
    throw new Error(i18n.t(failureKey));
  }

  return moved[0];
}

/**
 * Take a free task.
 *
 * Zero rows has two causes and the response cannot tell them apart: a
 * colleague was faster, or the task is past the day it could be done and the
 * server refused it. The message covers both rather than guessing.
 */
export function claimTask(taskId: string, cleanerId: string): Promise<CleaningTask> {
  return moveTask(
    taskId,
    'unassigned',
    { assignee_id: cleanerId, status: 'assigned' },
    'tasks.claimTaken',
  );
}

export function startTask(taskId: string): Promise<CleaningTask> {
  return moveTask(taskId, 'assigned', { status: 'in_progress' }, 'tasks.startFailed');
}

export function finishTask(taskId: string): Promise<CleaningTask> {
  return moveTask(taskId, 'in_progress', { status: 'done' }, 'tasks.finishFailed');
}
