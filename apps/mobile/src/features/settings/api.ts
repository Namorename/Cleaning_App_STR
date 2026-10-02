import type { Language } from '@str-ops/shared';

import { supabase } from '@/lib/supabase';

import { pushPreferencesSchema, type PushKind, type PushPreferences } from './schema';

/**
 * Which pushes she switched off, read from her own row.
 *
 * The filter is not redundant with row level security, for the reason
 * `fetchMyLanguage` gives: the policy answers with her row alone today, and a
 * query that says what it wants stays right if a policy ever widens.
 * No row is not an error: it is a person who never switched anything off.
 */
export async function fetchMyPushPreferences(userId: string): Promise<PushPreferences | null> {
  const { data, error } = await supabase
    .from('push_preferences')
    .select('profile_id, muted')
    .eq('profile_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data === null ? null : pushPreferencesSchema.parse(data);
}

/**
 * Switch one push on or off, as the value she wants rather than a toggle: a
 * replay after a lost answer lands where the first attempt did. The table is
 * read-only to the phone; this function is the one way to write it.
 */
export async function setPushPreference(
  kind: PushKind,
  enabled: boolean,
): Promise<PushPreferences> {
  const { data, error } = await supabase.rpc('set_push_preference', {
    p_kind: kind,
    p_enabled: enabled,
  });

  if (error) {
    throw error;
  }
  return pushPreferencesSchema.parse(data);
}

/**
 * Her language, written on her own profile — the same column the manager sets
 * in the panel, so whoever chose last wins and the panel shows it. The write
 * is hers by design (supabase/tests/profile_language.sql), and the enum turns
 * away a code the apps have no file for.
 *
 * The row is asked back because an update that matched nothing — an account
 * switched off meanwhile — is not an error to PostgREST, and a language that
 * silently did not stick would come back on the next start.
 */
export async function saveMyLanguage(userId: string, language: Language): Promise<void> {
  const { data, error } = await supabase
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
