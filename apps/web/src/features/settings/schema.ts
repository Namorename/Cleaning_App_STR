import { z } from 'zod';

/**
 * The company row, as far as the settings screen is concerned.
 *
 * Two switches, the three video limits (20261003170000) and the name they
 * belong to. Everything else on `hosts` — the default language, the
 * timestamps — is not edited here.
 */
export const hostSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  parallel_start_allowed: z.boolean(),
  gallery_allowed: z.boolean(),
  video_max_sec: z.number().int(),
  video_bitrate_kbps: z.number().int(),
  video_max_mb: z.number().int(),
});
export type HostSettings = z.infer<typeof hostSettingsSchema>;

/**
 * One control's worth of change.
 *
 * A field left out is left alone — the same contract as `update_host_settings`,
 * whose parameters default to null meaning "not part of this call". Each
 * switch saves itself, and the video form saves its three numbers together,
 * so pressing one never carries an implicit answer about another.
 */
export interface HostSettingsPatch {
  parallelStartAllowed?: boolean;
  galleryAllowed?: boolean;
  videoMaxSec?: number;
  videoBitrateKbps?: number;
  videoMaxMb?: number;
}
