import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

export type Client = SupabaseClient<Database>;

export const MEDIA_BUCKET = 'task-media';

/** How long a signed link to a photo stays good. Under the query's own lifetime. */
export const SIGNED_URL_SECONDS = 60 * 60;

/** A row of `task_media` carries the path; the panel needs a link it can open. */
export type WithUrl<T> = T & {
  /** A signed link, or null when storage refused to sign this path. */
  url: string | null;
};

/**
 * Ask storage for one signed link per path, in one call.
 *
 * A path storage will not sign is simply absent from the answer rather than
 * failing it: one unreadable photo must not take the whole card down with it.
 */
export async function signedUrlsByPath(
  client: Client,
  paths: readonly string[],
): Promise<Map<string, string>> {
  if (paths.length === 0) {
    return new Map();
  }
  const { data, error } = await client.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls([...paths], SIGNED_URL_SECONDS);
  if (error) {
    throw error;
  }
  return new Map(
    (data ?? [])
      .filter((entry) => entry.error === null && entry.path !== null && entry.signedUrl !== null)
      .map((entry) => [entry.path as string, entry.signedUrl as string]),
  );
}

/**
 * The same links, put back onto the rows that carry the paths.
 *
 * `isShownInList` picks the rows a list draws a picture of; the others (a
 * video, which a list draws as a tile) get no link until they are opened.
 */
export async function withSignedUrls<T extends { storage_path: string }>(
  client: Client,
  media: T[],
  isShownInList: (item: T) => boolean = () => true,
): Promise<WithUrl<T>[]> {
  const shown = media.filter(isShownInList);
  if (shown.length === 0) {
    return media.map((item) => ({ ...item, url: null }));
  }
  const urls = await signedUrlsByPath(
    client,
    shown.map((item) => item.storage_path),
  );
  return media.map((item) => ({ ...item, url: urls.get(item.storage_path) ?? null }));
}

/** A fresh link to one file, or word that storage no longer has it. */
export type SignedFile = { status: 'signed'; url: string } | { status: 'missing' };

/**
 * Storage's way of saying the object is not there: an answer of 400 whose
 * body says 404 (`NoSuchKey`). The nightly retention removes a file 90 days
 * after its job was closed, and that is the only way one goes missing.
 */
function isMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { statusCode, code, message } = error as {
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  return (
    statusCode === '404' ||
    code === 'NoSuchKey' ||
    (typeof message === 'string' && /object not found/i.test(message))
  );
}

/** One link, asked for when the file is opened or saved, not when a list is read. */
export async function signFile(client: Client, path: string): Promise<SignedFile> {
  const { data, error } = await client.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) {
    if (isMissingObject(error)) {
      return { status: 'missing' };
    }
    throw error;
  }
  return { status: 'signed', url: data.signedUrl };
}
