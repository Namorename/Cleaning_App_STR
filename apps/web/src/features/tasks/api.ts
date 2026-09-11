import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import { todayIso } from '@/lib/format-date';
import { withSignedUrls, type WithUrl } from '@/lib/media';

import {
  propertyListSchema,
  staffListSchema,
  taskListSchema,
  taskProblemListSchema,
  taskSchema,
  type Property,
  type Staff,
  type Task,
  type TaskDraft,
  type TaskProblem,
} from './schema';

export type Client = SupabaseClient<Database>;

/**
 * How far back the section reads.
 *
 * The closed tab is a recent history, not an archive: a manager looks at last
 * week's cleanings, and the report that answers "how much work was there in
 * June" is F12's, with its own query. Without a bound this list grows for as
 * long as the company exists and is fetched whole on every visit.
 */
export const HISTORY_DAYS = 30;

const TASK_COLUMNS =
  'id, property_id, reservation_id, problem_id, type, status, priority, assignee_id, ' +
  'created_by, scheduled_date, time_from, time_to, started_at, completed_at, ' +
  'measured_minutes, duration_override_min, is_parallel, is_short_measurement, ' +
  'notes, title, title_i18n, created_at, ' +
  'property:properties(name), ' +
  'assignee:profiles!tasks_assignee_id_fkey(full_name, role), ' +
  'author:profiles!tasks_created_by_fkey(full_name, role)';

/** A calendar day `days` before today, as `YYYY-MM-DD`. */
function daysAgo(days: number, now: Date = new Date()): string {
  const past = new Date(now);
  past.setDate(past.getDate() - days);
  return todayIso(past);
}

/** The company's schedule from HISTORY_DAYS ago onward. Row level security draws the line. */
export async function fetchTasks(client: Client): Promise<Task[]> {
  const { data, error } = await client
    .from('tasks')
    .select(TASK_COLUMNS)
    .gte('scheduled_date', daysAgo(HISTORY_DAYS))
    .order('scheduled_date', { ascending: true })
    .order('time_from', { ascending: true, nullsFirst: false });
  if (error) {
    throw error;
  }
  return taskListSchema.parse(data ?? []);
}

/** Active people of the company a task can be handed to. */
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

/**
 * Listings a task can be put on.
 *
 * Archived ones are out — that listing has left the company. A flat under
 * maintenance stays on offer: booking a technician onto it is the reason the
 * state exists.
 *
 * Rooms are out for now. Flattened into this list a room would sit next to
 * its own listing with nothing to say which building it is in; the picker
 * gains the hierarchy in the calendar phase and the rooms with it. *
 * The test is `hostaway_unit_id`, not `parent_id`. That column carries two
 * different relationships — a room of a multi-unit listing, and a part of a
 * combined listing, which is a real listing with its own calendar. Filtering on
 * `parent_id is null` would hide the second kind from the panel entirely, and
 * the Info tab can create one today.
 */
export async function fetchProperties(client: Client): Promise<Property[]> {
  const { data, error } = await client
    .from('properties')
    .select('id, name')
    .neq('status', 'archived')
    .is('hostaway_unit_id', null)
    .order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return propertyListSchema.parse(data ?? []);
}

export interface TaskStep {
  id: string;
  sort_order: number;
  type: string;
  required: boolean;
  title: string | null;
  title_i18n: Record<string, string> | null;
  completed_at: string | null;
  skipped_at: string | null;
  waived_at: string | null;
}

export interface TaskMedia {
  id: string;
  step_id: string | null;
  storage_path: string;
  created_at: string;
}

export interface TaskWork {
  steps: TaskStep[];
  /** The photos taken on the task, keyed by the step they belong to. */
  photosByStep: Record<string, WithUrl<TaskMedia>[]>;
}

/** What the cleaner actually did: the steps she was given, and what she photographed. */
export async function fetchTaskWork(client: Client, taskId: string): Promise<TaskWork> {
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

  const photos = await withSignedUrls(client, (mediaResult.data ?? []) as TaskMedia[]);
  const photosByStep = photos.reduce<Record<string, WithUrl<TaskMedia>[]>>((groups, photo) => {
    if (photo.step_id === null) {
      return groups;
    }
    return { ...groups, [photo.step_id]: [...(groups[photo.step_id] ?? []), photo] };
  }, {});

  return { steps: (stepsResult.data ?? []) as TaskStep[], photosByStep };
}

/** Problems the cleaner reported while doing this task. */
export async function fetchTaskProblems(client: Client, taskId: string): Promise<TaskProblem[]> {
  const { data, error } = await client
    .from('problems')
    .select('id, title, status, created_at')
    .eq('task_id', taskId)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) {
    throw error;
  }
  return taskProblemListSchema.parse(data ?? []);
}

export interface SaveTaskVariables {
  draft: TaskDraft;
  /** The manager saw "such a task already exists" and said to put it there anyway. */
  allowDuplicate?: boolean;
}

/**
 * Write a task, or rewrite one. The id comes from the panel, so a retry replays.
 *
 * `p_title_i18n` is deliberately not sent: the form has one title field, and
 * omitting the argument tells the server to leave whatever translations the
 * row carries alone rather than emptying them.
 */
export async function saveTask(client: Client, variables: SaveTaskVariables): Promise<Task> {
  const { draft } = variables;
  const { data, error } = await client.rpc('save_task', {
    p_id: draft.id,
    p_property_id: draft.propertyId ?? 0,
    p_type: draft.type,
    p_scheduled_date: draft.scheduledDate,
    p_title: draft.title.trim() === '' ? undefined : draft.title.trim(),
    p_assignee_id: draft.assigneeId ?? undefined,
    p_time_from: draft.timeFrom ?? undefined,
    p_time_to: draft.timeTo ?? undefined,
    p_notes: draft.notes.trim() === '' ? undefined : draft.notes.trim(),
    p_allow_duplicate: variables.allowDuplicate ?? false,
  });
  if (error) {
    throw error;
  }
  return taskSchema.parse(data);
}

/**
 * Call the job off. Nothing is deleted — a cancelled task stays as history,
 * and its day is free for something else. A manager writes tasks under row
 * level security; there is no RPC for this on purpose.
 */
export async function cancelTask(client: Client, taskId: string): Promise<void> {
  const { error } = await client.from('tasks').update({ status: 'cancelled' }).eq('id', taskId);
  if (error) {
    throw error;
  }
}

/**
 * Correct how long a finished cleaning is counted as.
 *
 * The measurement itself is never rewritten (§13.3): the correction goes into
 * its own column, and null takes it back to what the clock recorded.
 */
export async function setDurationOverride(
  client: Client,
  taskId: string,
  minutes: number | null,
): Promise<void> {
  const { error } = await client
    .from('tasks')
    .update({ duration_override_min: minutes })
    .eq('id', taskId);
  if (error) {
    throw error;
  }
}
