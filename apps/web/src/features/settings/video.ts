/**
 * The company's video limits (docs/tech-plan.md, 7.1–7.3 and 9;
 * 20261003170000): how long a video may run, the bitrate the phone gives its
 * camera, and the largest file add_task_media accepts.
 */

export const VIDEO_FIELDS = ['maxSec', 'bitrateKbps', 'maxMb'] as const;
export type VideoField = (typeof VIDEO_FIELDS)[number];

export type VideoLimits = Record<VideoField, number>;

/** The bounds of `hosts_video_*_range`; the server refuses outside them too. */
export const VIDEO_BOUNDS: Record<VideoField, { min: number; max: number }> = {
  maxSec: { min: 10, max: 600 },
  bitrateKbps: { min: 500, max: 20000 },
  maxMb: { min: 5, max: 150 },
};

/** The column each field is, as a refusal names it in `details.field`. */
export const VIDEO_COLUMN: Record<VideoField, string> = {
  maxSec: 'video_max_sec',
  bitrateKbps: 'video_bitrate_kbps',
  maxMb: 'video_max_mb',
};

/**
 * The two presets of the plan (owner's decision 12, 2026-10-01): 720p at
 * 2 Mbit/s for two minutes under a 45 MB file on Supabase's free plan; 720p
 * at 4.5 Mbit/s for three minutes under 140 MB on Pro.
 */
export const VIDEO_PRESETS = {
  free: { maxSec: 120, bitrateKbps: 2000, maxMb: 45 },
  pro: { maxSec: 180, bitrateKbps: 4500, maxMb: 140 },
} as const satisfies Record<string, VideoLimits>;
export type VideoPreset = keyof typeof VIDEO_PRESETS;

/**
 * The largest single upload Supabase's free plan allows, for the whole
 * project (Storage → Settings → «Global file size limit»). A higher file
 * limit is legal and works only once the project is on Pro.
 */
export const FREE_PLAN_FILE_MB = 50;

const BITS_PER_BYTE = 8;
const KILO = 1000;

/** A field's text as a whole number within its bounds, or null. */
export function videoFieldValue(field: VideoField, raw: string): number | null {
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const value = Number(text);
  const { min, max } = VIDEO_BOUNDS[field];
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** The size of a video of `seconds` at `bitrateKbps`, in megabytes of 10⁶ bytes. */
export function videoSizeMb(seconds: number, bitrateKbps: number): number {
  return (seconds * bitrateKbps) / BITS_PER_BYTE / KILO;
}

/** How long a recording runs at `bitrateKbps` before it reaches `maxMb`, in whole seconds. */
export function secondsUntilFull(maxMb: number, bitrateKbps: number): number {
  return Math.floor((maxMb * KILO * BITS_PER_BYTE) / bitrateKbps);
}

/** The field a refusal's `details.field` names, or null for one this build does not know. */
export function videoFieldOfColumn(column: unknown): VideoField | null {
  return VIDEO_FIELDS.find((field) => VIDEO_COLUMN[field] === column) ?? null;
}
