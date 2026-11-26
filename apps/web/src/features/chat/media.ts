import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import { uploadToAssignedPath, withoutMetadata } from '@/lib/media-upload';

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

/** Tell the server the file has arrived; it looks in the bucket before agreeing. */
async function confirmPhoto(client: Client, mediaId: string): Promise<ChatMessageMedia> {
  const { data, error } = await client.rpc('confirm_task_media', { p_id: mediaId });
  if (error) {
    throw error;
  }
  return chatMessageMediaSchema.parse(data);
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
  await uploadToAssignedPath(client, row.storage_path, file);
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
