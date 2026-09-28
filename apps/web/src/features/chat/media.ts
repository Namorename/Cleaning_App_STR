import type { SupabaseClient } from '@supabase/supabase-js';
import { stripImageMetadata, type Database } from '@str-ops/shared';

import { MEDIA_BUCKET } from '@/lib/media';

import { chatMessageMediaSchema, type ChatMessageMedia } from './schema';

export type Client = SupabaseClient<Database>;

/**
 * Where a photo of a message says it came from.
 *
 * A file dialog is a gallery, never a camera: the manager picks something that
 * already exists on her machine. The gallery gate does not apply to a
 * conversation (docs/chat-plan.md, layer 5) — the declaration is kept honest
 * all the same, because that is what the mark under the photo reads.
 */
const PANEL_PHOTO_SOURCE = 'gallery';

export interface AttachPhotoVariables {
  /** Minted by the panel, so a retry after a lost connection replays. */
  mediaId: string;
  messageId: string;
  file: File;
}

/** Register the photo and learn the one path its file may go to. */
async function registerPhoto(
  client: Client,
  variables: AttachPhotoVariables,
): Promise<ChatMessageMedia> {
  const { data, error } = await client.rpc('add_message_media', {
    p_id: variables.mediaId,
    p_message_id: variables.messageId,
    p_mime_type: variables.file.type,
    p_byte_size: variables.file.size,
    // What the file says about itself, the same way `source` above is a
    // declaration and not proof: for a picked file this is when it was last
    // written, which is the closest thing a browser will tell us.
    p_device_taken_at: new Date(variables.file.lastModified).toISOString(),
    p_source: PANEL_PHOTO_SOURCE,
  });
  if (error) {
    throw error;
  }
  return chatMessageMediaSchema.parse(data);
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
 * The bucket policy admits the path only while its row is waiting for a file,
 * so a duplicate is refused by storage — and read here as success, because
 * that is what it is when the chain is replayed.
 */
async function uploadPhotoFile(client: Client, storagePath: string, file: File): Promise<void> {
  const { error } = await client.storage.from(MEDIA_BUCKET).upload(storagePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error !== null && error !== undefined && !isAlreadyUploaded(error)) {
    throw error;
  }
}

/** Tell the server the file has arrived; it looks in the bucket before agreeing. */
async function confirmPhoto(client: Client, mediaId: string): Promise<ChatMessageMedia> {
  const { data, error } = await client.rpc('confirm_task_media', { p_id: mediaId });
  if (error) {
    throw error;
  }
  return chatMessageMediaSchema.parse(data);
}

/**
 * The picked file without what the camera wrote into it — where, when, on
 * which phone (owner's word, 2026-09-28). A photo from a manager's phone
 * arrives in the file dialog exactly as the phone saved it, GPS included.
 *
 * Done before the row is written: the row declares the size of what is
 * uploaded. The same file always strips to the same bytes, so a retry of the
 * chain declares and sends what the first attempt did. A file with nothing
 * to remove is sent as it is. A file that cannot be read as the picture it
 * says it is throws, and is not sent at all.
 */
async function withoutMetadata(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const clean = stripImageMetadata(bytes, file.type);
  if (clean === bytes) {
    return file;
  }
  return new File([clean.slice().buffer], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/**
 * The whole chain for one photo: row, file, confirmation.
 *
 * The row comes before the file, always (docs/chat-plan.md): the bucket admits
 * a path only while its row is waiting for one. Every link is replayable by
 * the id the panel minted, so a retry lands on the same row rather than a
 * second one — and a photo whose row expired before its file arrived answers
 * `messageMediaExpired` at whichever link it is retried from.
 */
export async function attachMessagePhoto(
  client: Client,
  variables: AttachPhotoVariables,
): Promise<ChatMessageMedia> {
  const file = await withoutMetadata(variables.file);
  const row = await registerPhoto(client, { ...variables, file });
  await uploadPhotoFile(client, row.storage_path, file);
  return confirmPhoto(client, variables.mediaId);
}

/**
 * Take a photo back. Only its author may, and only her own row; the file goes
 * with the retention sweep, never from here.
 */
export async function removeMessagePhoto(
  client: Client,
  mediaId: string,
): Promise<ChatMessageMedia> {
  const { data, error } = await client.rpc('remove_task_media', { p_id: mediaId });
  if (error) {
    throw error;
  }
  return chatMessageMediaSchema.parse(data);
}
