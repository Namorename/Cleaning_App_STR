import { z } from 'zod';

/** `media_kind`: what a file on a step is. */
export const MEDIA_KINDS = ['photo', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** `media_source`: what the app said about where a file came from. */
export const MEDIA_SOURCES = ['camera', 'gallery', 'unknown'] as const;

/**
 * The columns a job's step media is read with — by the task drawer and by the
 * repair steps on a problem card alike.
 *
 * `kind` decides whether a file is drawn as a picture or played; until
 * 2026-10-09 neither reader asked, and a video came out as a broken picture.
 * `duration_sec` is the phone's own timer, null on a photo.
 */
export const STEP_MEDIA_COLUMNS =
  'id, step_id, storage_path, created_at, source, kind, duration_sec';

/**
 * A file taken on a step of a job.
 *
 * Every field that can carry a value this build does not know falls back
 * rather than throws: one odd row must not take the whole list of steps down.
 * A kind added by a later migration reads as a photo — what every file was
 * before the kind was read at all.
 */
export const stepMediaSchema = z.object({
  id: z.string(),
  step_id: z.string().nullable(),
  storage_path: z.string(),
  created_at: z.string(),
  /** A declaration, not a proof — the server cannot see a camera. */
  source: z.enum(MEDIA_SOURCES).catch('unknown'),
  kind: z.enum(MEDIA_KINDS).catch('photo'),
  duration_sec: z.number().nullable().catch(null),
});
export type StepMedia = z.infer<typeof stepMediaSchema>;
export const stepMediaListSchema = z.array(stepMediaSchema);

/** The files of a job, keyed by the step they belong to; a file with no step is left out. */
export function groupByStep<T extends { step_id: string | null }>(
  media: readonly T[],
): Record<string, T[]> {
  return media.reduce<Record<string, T[]>>((groups, item) => {
    if (item.step_id === null) {
      return groups;
    }
    return { ...groups, [item.step_id]: [...(groups[item.step_id] ?? []), item] };
  }, {});
}

const SECONDS_PER_MINUTE = 60;

/** A video's length as `m:ss`; null when the length is not known. */
export function formatVideoDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  const rest = whole % SECONDS_PER_MINUTE;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
