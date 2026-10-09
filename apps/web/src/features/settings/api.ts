import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import { hostSettingsSchema, type HostSettings, type HostSettingsPatch } from './schema';

export type Client = SupabaseClient<Database>;

const HOST_COLUMNS =
  'id, name, parallel_start_allowed, gallery_allowed, ' +
  'video_max_sec, video_bitrate_kbps, video_max_mb';

/**
 * The company the reader belongs to.
 *
 * No filter and no id: the read policy on `hosts` already answers with one
 * row — the reader's own company — and naming it here would be a second
 * place to get the tenant wrong. `limit(1)` is belt and braces for the day a
 * second company appears and somebody forgets this line exists.
 */
export async function fetchHostSettings(client: Client): Promise<HostSettings | null> {
  const { data, error } = await client.from('hosts').select(HOST_COLUMNS).limit(1).maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? null : hostSettingsSchema.parse(data);
}

/**
 * Write the settings the caller names, and only those.
 *
 * A key left off the patch is left off the JSON, so the parameter falls back
 * to its null default and the RPC keeps whatever the column held. The table
 * itself is read-only to clients — this function is the only way in. A video
 * number out of bounds is refused with `videoSettingOutOfRange` and the field
 * and bounds in `details`.
 */
export async function saveHostSettings(client: Client, patch: HostSettingsPatch): Promise<void> {
  const { error } = await client.rpc('update_host_settings', {
    ...(patch.parallelStartAllowed === undefined
      ? {}
      : { p_parallel_start_allowed: patch.parallelStartAllowed }),
    ...(patch.galleryAllowed === undefined ? {} : { p_gallery_allowed: patch.galleryAllowed }),
    ...(patch.videoMaxSec === undefined ? {} : { p_video_max_sec: patch.videoMaxSec }),
    ...(patch.videoBitrateKbps === undefined
      ? {}
      : { p_video_bitrate_kbps: patch.videoBitrateKbps }),
    ...(patch.videoMaxMb === undefined ? {} : { p_video_max_mb: patch.videoMaxMb }),
  });
  if (error) {
    throw error;
  }
}
