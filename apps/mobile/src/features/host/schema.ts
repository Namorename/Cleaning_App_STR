import { z } from 'zod';

/**
 * The server's own defaults for the three video numbers
 * (20261003170000_video_limits.sql). They fill a company row the build before
 * video saved on disk, which never asked for them; a fresh read always brings
 * the company's real numbers.
 */
export const SERVER_VIDEO_MAX_SEC = 120;
export const SERVER_VIDEO_BITRATE_KBPS = 2000;
export const SERVER_VIDEO_MAX_MB = 45;

/**
 * What the phone needs to know about the company it works for.
 *
 * The gallery switch, and the three numbers a recording is held to: its
 * length in seconds, its video bitrate in kbit/s, and its file size in MB of
 * 10^6 bytes (docs/tech-plan.md §7.1). The read policy on `hosts` answers
 * with the reader's own company and nothing else.
 *
 * The same schema reads the server's answer and the copy restored from disk
 * (`readCached`), so the video numbers are defaulted: an older copy lacks
 * them and must still open the gallery as it did.
 */
export const hostSettingsSchema = z.object({
  id: z.string(),
  gallery_allowed: z.boolean(),
  video_max_sec: z.number().int().positive().default(SERVER_VIDEO_MAX_SEC),
  video_bitrate_kbps: z.number().int().positive().default(SERVER_VIDEO_BITRATE_KBPS),
  video_max_mb: z.number().int().positive().default(SERVER_VIDEO_MAX_MB),
});
export type HostSettings = z.infer<typeof hostSettingsSchema>;

/** The company's numbers for a recording, as `videoLimits` reads them. */
export type VideoSettings = Pick<
  HostSettings,
  'video_max_sec' | 'video_bitrate_kbps' | 'video_max_mb'
>;
