import { SUPPORTED_LANGUAGES } from '@str-ops/shared';
import { z } from 'zod';

import { supabase } from '@/lib/supabase';

/**
 * The language this person was given, as the manager set it in the panel.
 *
 * `preferred_language` has been on `profiles` since the panel could set it;
 * the phone simply never read it and went on reading the device locale. A
 * cleaner handed an English profile kept getting Russian, because Russian is
 * what her phone is set to.
 *
 * `.catch(null)` is not decoration: a language added to the enum after this
 * build shipped would otherwise throw on parse and take the screen with it.
 * An unknown code means "this build cannot read that", and falling back to the
 * device is the honest answer.
 */
const profileLanguageSchema = z.object({
  id: z.string(),
  preferred_language: z.enum(SUPPORTED_LANGUAGES).nullable().catch(null),
});

export type ProfileLanguage = z.infer<typeof profileLanguageSchema>;

/**
 * Her own row, asked for by id.
 *
 * The filter is not redundant with row level security. A cleaner's policy
 * hands her exactly one row, but a manager's hands her every profile in the
 * company — and a manager signs into this app too.
 */
export async function fetchMyLanguage(userId: string): Promise<ProfileLanguage | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, preferred_language')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (data === null) {
    return null;
  }
  return profileLanguageSchema.parse(data);
}
