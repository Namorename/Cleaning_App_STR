import { z } from 'zod';

/**
 * The company row, as far as the settings screen is concerned.
 *
 * Two switches and the name they belong to. Everything else on `hosts` —
 * the default language, the timestamps — is not edited here.
 */
export const hostSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  parallel_start_allowed: z.boolean(),
  gallery_allowed: z.boolean(),
});
export type HostSettings = z.infer<typeof hostSettingsSchema>;

/**
 * One switch's worth of change.
 *
 * A field left out is left alone — the same contract as `update_host_settings`,
 * whose parameters default to null meaning "not part of this call". Each
 * control on the screen saves itself, so pressing one never carries an
 * implicit answer about the other.
 */
export interface HostSettingsPatch {
  parallelStartAllowed?: boolean;
  galleryAllowed?: boolean;
}
