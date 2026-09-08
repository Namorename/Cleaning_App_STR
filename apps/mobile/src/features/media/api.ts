import type { Database } from '@str-ops/shared';

import { supabase } from '@/lib/supabase';

import { readFileBytes } from './file';
import {
  MEDIA_BUCKET,
  taskMediaListSchema,
  taskMediaSchema,
  type MediaKind,
  type TaskMedia,
} from './schema';

const MEDIA_COLUMNS =
  'id, task_id, step_id, problem_id, kind, storage_path, mime_type, duration_sec, ' +
  'device_taken_at, created_at, uploaded_at, deleted_at';

/** How long a signed link to a photo stays good. Under the query's own lifetime. */
export const SIGNED_URL_SECONDS = 60 * 60;

/**
 * The media of one task, taken back ones excluded.
 *
 * Row level security hands back only what she may see: her own tasks, or the
 * whole company for a manager.
 */
export async function fetchTaskMedia(taskId: string): Promise<TaskMedia[]> {
  const { data, error } = await supabase
    .from('task_media')
    .select(MEDIA_COLUMNS)
    .eq('task_id', taskId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return taskMediaListSchema.parse(data ?? []);
}

/** The photos of one problem report, taken back ones excluded. */
export async function fetchProblemMedia(problemId: string): Promise<TaskMedia[]> {
  const { data, error } = await supabase
    .from('task_media')
    .select(MEDIA_COLUMNS)
    .eq('problem_id', problemId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return taskMediaListSchema.parse(data ?? []);
}

type MediaFunction =
  | 'add_task_media'
  | 'add_problem_media'
  | 'confirm_task_media'
  | 'remove_task_media';

type MediaFunctionArgs<TName extends MediaFunction> =
  Database['public']['Functions'][TName]['Args'];

async function callMediaFunction<TName extends MediaFunction>(
  name: TName,
  args: MediaFunctionArgs<TName>,
): Promise<TaskMedia> {
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    throw error;
  }

  return taskMediaSchema.parse(data);
}

/**
 * Who a file belongs to: a step of a task, or a problem report. The task id
 * is what the caches are keyed by; the server needs only the step or the
 * problem.
 */
export interface MediaOwnerRef {
  taskId?: string;
  stepId?: string;
  problemId?: string;
}

export interface AddMediaVariables extends MediaOwnerRef {
  mediaId: string;
  kind: MediaKind;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  takenAt: string;
}

/** Register the file and learn where it has to go. Replayable by id. */
export function addMedia(variables: AddMediaVariables): Promise<TaskMedia> {
  if (variables.problemId !== undefined) {
    return callMediaFunction('add_problem_media', {
      p_id: variables.mediaId,
      p_problem_id: variables.problemId,
      p_mime_type: variables.mimeType,
      p_byte_size: variables.byteSize,
      p_width: variables.width ?? undefined,
      p_height: variables.height ?? undefined,
      p_device_taken_at: variables.takenAt,
    });
  }
  if (variables.stepId === undefined) {
    return Promise.reject(new Error('Media needs a step or a problem to belong to'));
  }

  return callMediaFunction('add_task_media', {
    p_id: variables.mediaId,
    p_step_id: variables.stepId,
    p_kind: variables.kind,
    p_mime_type: variables.mimeType,
    p_byte_size: variables.byteSize,
    p_width: variables.width ?? undefined,
    p_height: variables.height ?? undefined,
    p_duration_sec: variables.durationSec ?? undefined,
    p_device_taken_at: variables.takenAt,
  });
}

export function confirmMedia(mediaId: string): Promise<TaskMedia> {
  return callMediaFunction('confirm_task_media', { p_id: mediaId });
}

export function removeMedia(mediaId: string): Promise<TaskMedia> {
  return callMediaFunction('remove_task_media', { p_id: mediaId });
}

interface StorageFailure {
  message?: unknown;
  statusCode?: unknown;
}

/** The object is there already — an earlier attempt got through after all. */
function isAlreadyUploaded(error: unknown): boolean {
  const { message, statusCode } = (error ?? {}) as StorageFailure;
  return statusCode === '409' || (typeof message === 'string' && /already exists/i.test(message));
}

/**
 * Put the file onto the path the server assigned.
 *
 * The bucket policy admits the path only while its row is waiting for a
 * file, so a duplicate is refused by Storage — and read here as success,
 * because that is what it is when the chain is replayed.
 */
export async function uploadMediaFile(
  storagePath: string,
  uri: string,
  mimeType: string,
): Promise<void> {
  const body = await readFileBytes(uri);
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(storagePath, body, {
    contentType: mimeType,
    upsert: false,
  });

  if (error && !isAlreadyUploaded(error)) {
    throw error;
  }
}

/**
 * Links a screen can show, one per path, good for an hour.
 *
 * A path the server would not sign (a file purged by retention, say) is
 * simply absent from the result rather than failing the rest.
 */
export async function signedMediaUrls(paths: readonly string[]): Promise<Record<string, string>> {
  if (paths.length === 0) {
    return {};
  }

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls([...paths], SIGNED_URL_SECONDS);

  if (error) {
    throw error;
  }

  return Object.fromEntries(
    (data ?? [])
      .filter((entry) => entry.error === null && entry.path !== null && entry.signedUrl !== null)
      .map((entry) => [entry.path as string, entry.signedUrl as string]),
  );
}
