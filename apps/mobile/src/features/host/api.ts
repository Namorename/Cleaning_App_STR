import { z } from 'zod';

import { supabase } from '@/lib/supabase';

/**
 * What the phone needs to know about the company it works for.
 *
 * One switch so far. The read policy on `hosts` answers with the reader's own
 * company and nothing else, so there is no filter to get wrong here.
 */
const hostSettingsSchema = z.object({
  id: z.string(),
  gallery_allowed: z.boolean(),
});
export type HostSettings = z.infer<typeof hostSettingsSchema>;

export async function fetchHostSettings(): Promise<HostSettings> {
  const { data, error } = await supabase
    .from('hosts')
    .select('id, gallery_allowed')
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (data === null) {
    throw new Error('The company row is not readable');
  }
  return hostSettingsSchema.parse(data);
}
