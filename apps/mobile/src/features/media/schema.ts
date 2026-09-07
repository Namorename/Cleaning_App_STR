import { z } from 'zod';

import type { TaskStep } from '@/features/steps/schema';

/** The bucket every task photo and video lives in. Mirrors 20260907160100. */
export const MEDIA_BUCKET = 'task-media';

export const MEDIA_KINDS = ['photo', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Limits the manager left unset fall back to these — the same numbers the
 * database uses (`task_media_max_photos()`, `task_media_max_video_sec()`),
 * so the button goes grey exactly where the server would refuse.
 */
export const DEFAULT_MIN_PHOTOS = 1;
export const DEFAULT_MAX_PHOTOS = 10;
export const DEFAULT_MAX_VIDEO_SEC = 30;

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
  task_id: z.string().uuid(),
  step_id: z.string().uuid(),
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

/** The longest video the step accepts, in seconds. */
export function videoLimitSec(step: Pick<TaskStep, 'max_video_sec'>): number {
  return step.max_video_sec ?? DEFAULT_MAX_VIDEO_SEC;
}

/** The media of one step that still count — taken and not taken back. */
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
