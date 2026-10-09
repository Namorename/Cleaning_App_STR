import { z } from 'zod';

/**
 * What the phone needs to know about the company it works for.
 *
 * The gallery switch, and the three numbers a recording is held to: its
 * length in seconds, its video bitrate in kbit/s, and its file size in MB of
 * 10^6 bytes (docs/tech-plan.md §7.1). The read policy on `hosts` answers
 * with the reader's own company and nothing else.
 *
 * The same schema reads the server's answer and the copy restored from disk
 * (`readCached`). The build before video saved the company without its video
 * numbers: such a copy still opens the gallery as it did, and its numbers
 * read as null — unknown, never the server's defaults passed off as the
 * company's (`useVideoSettings`), until a fresh read brings them.
 */
export const hostSettingsSchema = z.object({
  id: z.string(),
  gallery_allowed: z.boolean(),
  video_max_sec: z.number().int().positive().nullable().default(null),
  video_bitrate_kbps: z.number().int().positive().nullable().default(null),
  video_max_mb: z.number().int().positive().nullable().default(null),
});
export type HostSettings = z.infer<typeof hostSettingsSchema>;

/** The company's numbers for a recording, as `videoLimits` reads them: all three known. */
export interface VideoSettings {
  video_max_sec: number;
  video_bitrate_kbps: number;
  video_max_mb: number;
}

/** The three numbers as a row may carry them: any of them missing or null. */
export type MaybeVideoSettings = Partial<Record<keyof VideoSettings, number | null>>;

/** The three numbers when the company's row has them all, else null: not known yet. */
export function videoSettingsOf(settings: MaybeVideoSettings | undefined): VideoSettings | null {
  const seconds = settings?.video_max_sec ?? null;
  const kbps = settings?.video_bitrate_kbps ?? null;
  const megabytes = settings?.video_max_mb ?? null;
  if (seconds === null || kbps === null || megabytes === null) {
    return null;
  }
  return { video_max_sec: seconds, video_bitrate_kbps: kbps, video_max_mb: megabytes };
}
