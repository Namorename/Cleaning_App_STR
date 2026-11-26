import {
  ADDITION_SELECT,
  ADDITION_STAGES,
  isShownAdditionFile,
  type AdditionStage,
} from '@str-ops/shared';
import { z } from 'zod';

import type { MediaKind } from '@/features/media/schema';
import { withSignedUrls, type WithUrl } from '@/lib/media';
import { uploadToAssignedPath } from '@/lib/media-upload';

import type { Client } from './api';

/**
 * What the office adds to a task (20261126100000): batches of photos and videos, at work or with
 * its closing, and the closing's comment, which lives in the task's chat. Read by whoever reads
 * the task; written by the office through the media pipeline.
 */

const additionFileSchema = z.object({
  id: z.string(),
  kind: z.enum(['photo', 'video']),
  storage_path: z.string(),
  mime_type: z.string(),
  duration_sec: z.number().nullable(),
  created_at: z.string(),
  uploaded_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  purged_at: z.string().nullable(),
});

const additionSchema = z.object({
  id: z.string(),
  problem_id: z.string(),
  author_id: z.string().nullable(),
  author_name: z.string().nullable(),
  stage: z.enum(ADDITION_STAGES),
  created_at: z.string(),
  published_at: z.string(),
  files: z.array(additionFileSchema),
  message: z.object({ id: z.string(), body: z.string() }).nullable(),
});

export type AdditionFile = WithUrl<z.infer<typeof additionFileSchema>>;

export interface Addition {
  id: string;
  stage: AdditionStage;
  authorId: string | null;
  /** The name as it was when the batch was sent. */
  authorName: string | null;
  publishedAt: string;
  /** The files to show, oldest first. */
  files: AdditionFile[];
  /** The closing's comment, from the task's chat; null at work or without one. */
  comment: string | null;
}

function byCreated(left: { created_at: string; id: string }, right: { created_at: string; id: string }) {
  return left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id);
}

/** The task's batches in the order they were sent, with links to their photos. */
export async function fetchAdditions(client: Client, problemId: string): Promise<Addition[]> {
  const { data, error } = await client
    .from('problem_additions')
    .select(ADDITION_SELECT)
    .eq('problem_id', problemId)
    .order('published_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw error;
  }
  const rows = z.array(additionSchema).parse(data ?? []);
  const files = rows.flatMap((row) => row.files.filter(isShownAdditionFile));
  // A video is a tile in the list and gets its link when it is opened (MediaGallery).
  const signed = await withSignedUrls(client, files, (file) => file.kind === 'photo');
  const linkOf = new Map(signed.map((file) => [file.id, file.url]));
  return rows.map((row) => ({
    id: row.id,
    stage: row.stage,
    authorId: row.author_id,
    authorName: row.author_name,
    publishedAt: row.published_at,
    files: row.files
      .filter(isShownAdditionFile)
      .sort(byCreated)
      .map((file) => ({ ...file, url: linkOf.get(file.id) ?? null })),
    comment: row.message?.body ?? null,
  }));
}

export interface OfficeFileVariables {
  /** Minted with the pick, so a retry of the chain replays under it. */
  mediaId: string;
  /** The batch, minted with the form. */
  additionId: string;
  problemId: string;
  /** The file as it is sent: a photo already redrawn (office-files.ts preparePhoto). */
  file: File;
  kind: MediaKind;
  durationSec: number | null;
}

const registeredSchema = z.object({
  storage_path: z.string(),
  uploaded_at: z.string().nullable(),
});

/**
 * The whole chain for one file: row, file, confirmation (the pipeline's order: the bucket admits
 * a path only while its row waits for one). Every link replays by the ids the panel minted.
 */
export async function attachOfficeFile(client: Client, variables: OfficeFileVariables): Promise<void> {
  const { file } = variables;
  const registered = await client.rpc('add_office_media', {
    p_id: variables.mediaId,
    p_addition_id: variables.additionId,
    p_problem_id: variables.problemId,
    p_kind: variables.kind,
    p_mime_type: file.type,
    p_byte_size: file.size,
    p_duration_sec: variables.durationSec ?? undefined,
    // What the file says of itself: for a picked file, when it was last written.
    p_device_taken_at: new Date(file.lastModified).toISOString(),
    // A file dialog is a gallery, never a camera (as the chat's photos, chat/media.ts).
    p_source: 'gallery',
  });
  if (registered.error) {
    throw registered.error;
  }
  const row = registeredSchema.parse(registered.data);
  if (row.uploaded_at === null) {
    await uploadToAssignedPath(client, row.storage_path, file);
    const confirmed = await client.rpc('confirm_task_media', { p_id: variables.mediaId });
    if (confirmed.error) {
      throw confirmed.error;
    }
  }
}

/** «Добавить»: the batch shows on the task with the files that arrived. */
export async function publishOfficeFiles(client: Client, additionId: string): Promise<void> {
  const { error } = await client.rpc('publish_office_media', { p_addition_id: additionId });
  if (error) {
    throw error;
  }
}
