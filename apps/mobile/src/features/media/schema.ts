import { z } from 'zod';

import type { VideoSettings } from '@/features/host/schema';
import type { TaskStep } from '@/features/steps/schema';

/** The bucket every task photo and video lives in. Mirrors 20260907160100. */
export const MEDIA_BUCKET = 'task-media';

export const MEDIA_KINDS = ['photo', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Photo limits the manager left unset fall back to these — the same numbers
 * the database uses (`task_media_max_photos()`), so the button goes grey
 * exactly where the server would refuse. A video's limits are the company's
 * (`videoLimits`).
 */
export const DEFAULT_MIN_PHOTOS = 1;
export const DEFAULT_MAX_PHOTOS = 10;

/** The company's video size is in MB of 10^6 bytes, as the server counts it. */
const BYTES_PER_MB = 1_000_000;
const BITS_PER_KBIT = 1000;

/**
 * One photo or video as the app reads it.
 *
 * Only the columns the screen needs; the rest (host, sizes, purge marks)
 * stay on the server. `uploaded_at` is what separates evidence from an
 * intention: a row without it has a file on its way, or one that never
 * arrived.
 */
export const taskMediaSchema = z.object({
  id: z.string().uuid(),
  // Exactly one owner: a task step, or a problem report (F9).
  task_id: z.string().uuid().nullable(),
  step_id: z.string().uuid().nullable(),
  problem_id: z.string().uuid().nullable().default(null),
  kind: z.enum(MEDIA_KINDS),
  storage_path: z.string(),
  mime_type: z.string(),
  duration_sec: z.number().nullable(),
  device_taken_at: z.string().nullable(),
  created_at: z.string(),
  uploaded_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
});

export type TaskMedia = z.infer<typeof taskMediaSchema>;

export const taskMediaListSchema = z.array(taskMediaSchema);

/** Which kind of media a step collects, or none for a step that collects text. */
export function mediaKindOfStep(type: string): MediaKind | null {
  if (type === 'photos_before' || type === 'photos_after') {
    return 'photo';
  }
  if (type === 'video') {
    return 'video';
  }
  return null;
}

export interface PhotoLimits {
  min: number;
  max: number;
}

/** How many photos the step wants, with the server's defaults filled in. */
export function photoLimits(step: Pick<TaskStep, 'min_photos' | 'max_photos'>): PhotoLimits {
  return {
    min: step.min_photos ?? DEFAULT_MIN_PHOTOS,
    max: step.max_photos ?? DEFAULT_MAX_PHOTOS,
  };
}

/** What one recording of a step is held to. */
export interface VideoLimits {
  /** The longest recording the server accepts for this step. */
  seconds: number;
  /** The largest file, in bytes. */
  maxBytes: number;
  /** The video bitrate the camera aims at, in bits per second. */
  bitrate: number;
}

/**
 * The limits of a step's recording: the server's rule, worked out here so the
 * camera stops exactly where the server would refuse. The length is the
 * step's own when it has one, but never more than the company allows —
 * `least(coalesce(step, company), company)` in `add_task_media`.
 */
export function videoLimits(
  step: Pick<TaskStep, 'max_video_sec'>,
  company: VideoSettings,
): VideoLimits {
  return {
    seconds: Math.min(step.max_video_sec ?? company.video_max_sec, company.video_max_sec),
    maxBytes: company.video_max_mb * BYTES_PER_MB,
    bitrate: company.video_bitrate_kbps * BITS_PER_KBIT,
  };
}

/** The media of one step that still count — taken and not taken back. */
/** The photos of one problem report, taken back ones excluded, in the order taken. */
export function mediaOfProblem(media: readonly TaskMedia[], problemId: string): TaskMedia[] {
  return media
    .filter((item) => item.problem_id === problemId && item.deleted_at === null)
    .sort((a, b) => {
      const byTaken = (a.device_taken_at ?? a.created_at).localeCompare(
        b.device_taken_at ?? b.created_at,
      );
      return byTaken !== 0 ? byTaken : a.id.localeCompare(b.id);
    });
}

export function mediaOfStep(media: readonly TaskMedia[], stepId: string): TaskMedia[] {
  return media
    .filter((item) => item.step_id === stepId && item.deleted_at === null)
    .sort((a, b) => {
      const byTaken = (a.device_taken_at ?? a.created_at).localeCompare(
        b.device_taken_at ?? b.created_at,
      );
      return byTaken !== 0 ? byTaken : a.id.localeCompare(b.id);
    });
}

export type MediaStatus = 'uploading' | 'uploaded' | 'failed';

/** One tile on the step screen: what to show and where it stands. */
export interface MediaItemView {
  id: string;
  kind: MediaKind;
  /** Something expo-image can show: the local file, or a signed URL. Null while neither is known. */
  uri: string | null;
  status: MediaStatus;
  durationSec: number | null;
}

/**
 * Whether the step can be completed with what is on screen.
 *
 * The rule the server applies: every file arrived, at least the minimum,
 * not more than the maximum. Deciding it here only keeps the button honest.
 */
export function canCompleteMediaStep(
  kind: MediaKind,
  items: readonly MediaItemView[],
  limits: PhotoLimits,
): boolean {
  if (items.some((item) => item.status !== 'uploaded')) {
    return false;
  }
  const { min, max } = kind === 'video' ? { min: 1, max: 1 } : limits;
  return items.length >= min && items.length <= max;
}
