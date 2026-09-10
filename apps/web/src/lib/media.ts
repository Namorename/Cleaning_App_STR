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
 * Ask storage for one signed link per row, in one call.
 *
 * A path storage will not sign comes back with a null link rather than
 * throwing: one unreadable photo must not take the whole card down with it.
 */
export async function withSignedUrls<T extends { storage_path: string }>(
  client: Client,
  media: T[],
): Promise<WithUrl<T>[]> {
  if (media.length === 0) {
    return [];
  }
  const { data, error } = await client.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(
      media.map((item) => item.storage_path),
      SIGNED_URL_SECONDS,
    );
  if (error) {
    throw error;
  }
  const urls = new Map(
    (data ?? [])
      .filter((entry) => entry.error === null && entry.path !== null)
      .map((entry) => [entry.path as string, entry.signedUrl]),
  );
  return media.map((item) => ({ ...item, url: urls.get(item.storage_path) ?? null }));
}
