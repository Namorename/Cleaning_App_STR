import { supabase } from '@/lib/supabase';

import { hostSettingsSchema, type HostSettings } from './schema';

export type { HostSettings } from './schema';

/**
 * The company's settings: the gallery switch, the three video numbers and how
 * a cleaner names a task. The read policy on `hosts` answers with the reader's
 * own company and nothing else, so there is no filter to get wrong here.
 */
export async function fetchHostSettings(): Promise<HostSettings> {
  const { data, error } = await supabase
    .from('hosts')
    .select(
      'id, gallery_allowed, video_max_sec, video_bitrate_kbps, video_max_mb, problem_report_mode',
    )
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
