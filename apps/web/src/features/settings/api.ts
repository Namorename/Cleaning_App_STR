import type { SupabaseClient } from '@supabase/supabase-js';
import { isSupportedLanguage, type Database, type Language } from '@str-ops/shared';

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

/**
 * The language the signed-in person keeps in her profile, or null when she
 * never chose one — or chose a code this build has no dictionary for. The
 * same column the phone writes and the pushes are worded by; `id` is hers, and
 * the policy «read own profile» answers for it.
 */
export async function fetchMyLanguage(client: Client, userId: string): Promise<Language | null> {
  const { data, error } = await client
    .from('profiles')
    .select('preferred_language')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  const code = data?.preferred_language ?? null;
  return code !== null && isSupportedLanguage(code) ? code : null;
}

/**
 * Her language, written on her own profile — as the phone does it
 * (apps/mobile/src/features/settings/api.ts): the policy «update own profile»
 * lets it through and the enum turns away a code no app has a file for.
 *
 * The row is asked back because an update that matched nothing is not an
 * error to PostgREST, and a language that silently did not stick would come
 * back on the next sign-in.
 */
export async function saveMyLanguage(
  client: Client,
  userId: string,
  language: Language,
): Promise<void> {
  const { data, error } = await client
    .from('profiles')
    .update({ preferred_language: language })
    .eq('id', userId)
    .select('id')
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (data === null) {
    throw new Error('Own profile row was not updated');
  }
}
