import { ADDITION_SELECT, ADDITION_STAGES, isShownAdditionFile } from '@str-ops/shared';
import { z } from 'zod';

import type { CapturedMedia } from '@/features/media/capture';
import { taskMediaSchema, type TaskMedia } from '@/features/media/schema';
import { supabase } from '@/lib/supabase';

/**
 * What the office adds to a task (20261126100000): batches of photos and videos, at work or with
 * its closing, and the closing's comment, which lives in the task's chat. Read by whoever reads
 * the task — the reporter, the technician at work, the office; written by the office alone.
 */

const additionFileSchema = z.object({
  id: z.string(),
  kind: z.enum(['photo', 'video']),
  storage_path: z.string(),
  mime_type: z.string(),
  duration_sec: z.number().nullable().default(null),
  created_at: z.string(),
  uploaded_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  purged_at: z.string().nullable(),
});

export type AdditionFile = z.infer<typeof additionFileSchema>;

/** One batch as the screens read it; a newer shape the build does not know reads as nothing. */
export const additionSchema = z.object({
  id: z.string(),
  problem_id: z.string(),
  author_id: z.string().nullable().default(null),
  author_name: z.string().nullable().default(null),
  stage: z.enum(ADDITION_STAGES),
  created_at: z.string(),
  published_at: z.string(),
  files: z.array(additionFileSchema).default([]),
  message: z.object({ id: z.string(), body: z.string() }).nullable().default(null),
});

export type Addition = z.infer<typeof additionSchema>;

export const additionListSchema = z.array(additionSchema);

/** The task's batches in the order they were sent. */
export async function fetchAdditions(problemId: string): Promise<Addition[]> {
  const { data, error } = await supabase
    .from('problem_additions')
    .select(ADDITION_SELECT)
    .eq('problem_id', problemId)
    .order('published_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw error;
  }
  return additionListSchema.parse(data ?? []);
}

/** The files of a batch to show, oldest first. */
export function shownFiles(addition: Addition): AdditionFile[] {
  return addition.files
    .filter(isShownAdditionFile)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/**
 * The batch of the task's current closing: the last one sent with a closing, while the task is
 * closed. Every other batch is the list's.
 */
export function currentClosingAddition(
  additions: readonly Addition[],
  isClosed: boolean,
): Addition | null {
  if (!isClosed) {
    return null;
  }
  return additions.filter((addition) => addition.stage === 'closing').at(-1) ?? null;
}

/** Register one file of the office's batch and learn its path. Replayable by the file's id. */
export async function addOfficeMedia(
  problemId: string,
  additionId: string,
  captured: CapturedMedia,
): Promise<TaskMedia> {
  const { data, error } = await supabase.rpc('add_office_media', {
    p_id: captured.id,
    p_addition_id: additionId,
    p_problem_id: problemId,
    p_kind: captured.kind,
    p_mime_type: captured.mimeType,
    p_byte_size: captured.byteSize,
    p_width: captured.width ?? undefined,
    p_height: captured.height ?? undefined,
    p_duration_sec: captured.durationSec ?? undefined,
    p_device_taken_at: captured.takenAt,
    p_source: captured.source,
  });
  if (error) {
    throw error;
  }
  return taskMediaSchema.parse(data);
}

/** «Добавить»: the batch shows on the task with the files that arrived. */
export async function publishOfficeMedia(additionId: string): Promise<void> {
  const { error } = await supabase.rpc('publish_office_media', { p_addition_id: additionId });
  if (error) {
    throw error;
  }
}
