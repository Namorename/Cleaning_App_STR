import type { TaskStatus } from '@str-ops/shared';

import { supabase } from '@/lib/supabase';

import { cleaningTaskListSchema, type CleaningTask } from './schema';

// The joined listing name is what the cleaner actually recognises; the numeric
// id means nothing to her.
const TASK_COLUMNS =
  'id, status, priority, scheduled_date, due_at, assignee_id, property_id, property:properties(name)';

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
 */
export async function fetchFreeTasks(): Promise<CleaningTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('type', 'cleaning')
    .eq('status', 'unassigned')
    .is('assignee_id', null)
    .order('scheduled_date', { ascending: true })
    .order('priority', { ascending: false });

  if (error) {
    throw error;
  }

  return cleaningTaskListSchema.parse(data ?? []);
}

/**
 * Take a free task.
 *
 * The `status` filter is what makes this safe against two cleaners tapping at
 * once: the second update matches no row and the caller is told the task is
 * gone, rather than silently overwriting the first claim.
 */
export async function claimTask(taskId: string, cleanerId: string): Promise<CleaningTask> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ assignee_id: cleanerId, status: 'assigned' })
    .eq('id', taskId)
    .eq('status', 'unassigned')
    .select(TASK_COLUMNS);

  if (error) {
    throw error;
  }

  const claimed = cleaningTaskListSchema.parse(data ?? []);
  if (claimed.length === 0) {
    throw new Error('Задачу уже взял кто-то другой.');
  }

  return claimed[0];
}
