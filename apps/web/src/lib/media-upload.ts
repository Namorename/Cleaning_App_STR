import type { SupabaseClient } from '@supabase/supabase-js';
import { stripImageMetadata, type Database } from '@str-ops/shared';

import { MEDIA_BUCKET } from '@/lib/media';

type Client = SupabaseClient<Database>;

interface StorageFailure {
  message?: unknown;
  statusCode?: unknown;
}

/** The object is there already — an earlier attempt got through after all. */
export function isAlreadyUploaded(error: unknown): boolean {
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
export async function uploadToAssignedPath(
  client: Client,
  storagePath: string,
  file: File,
): Promise<void> {
  const { error } = await client.storage.from(MEDIA_BUCKET).upload(storagePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error !== null && error !== undefined && !isAlreadyUploaded(error)) {
    throw error;
  }
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
export async function withoutMetadata(file: File): Promise<File> {
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
