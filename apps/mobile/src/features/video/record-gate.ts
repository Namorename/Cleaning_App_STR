import type { VideoSettings } from '@/features/host/schema';
import {
  mediaOfStep,
  videoLimits,
  type TaskMedia,
  type VideoLimits,
} from '@/features/media/schema';
import { stepStatusLine } from '@/features/steps/format';
import { stepState, type TaskStep } from '@/features/steps/schema';
import { i18n } from '@/i18n';

/** Whether the camera opens, and if not, what the screen says instead. */
export type RecordGate =
  | { kind: 'loading' }
  | { kind: 'error'; error: Error }
  | { kind: 'refused'; text: string }
  | { kind: 'open'; limits: VideoLimits };

/** What the recording screen knows when it is asked to open the camera. */
export interface RecordGateInput {
  isParsed: boolean;
  userId: string | null;
  stepId: string;
  task: { isPending: boolean; data?: { status: string; assignee_id: string | null } | null };
  steps: { isPending: boolean; error: Error | null; data?: readonly TaskStep[] };
  /** The task's media, the way the step's screen counts them: unknown until read. */
  media: { isPending: boolean; error: Error | null; data?: readonly TaskMedia[] };
  /** The media the upload queue is sending right now: their tiles hide «Удалить». */
  uploadingIds: ReadonlySet<string>;
  videoSettings: VideoSettings | null;
}

/** A video step holds one video (`add_task_media`). */
const VIDEOS_PER_STEP = 1;

/**
 * The checks of the step's own «Записать видео», made again for a screen that
 * may be reached some other way — a link, a screen kept in the history — so
 * no camera opens for a recording the server would refuse after she has made
 * it. In the order the step's screen meets them: her task under way, the step
 * still to do, its video not yet taken, the company's numbers known. Each
 * refusal is said in the words the step's screen uses for it.
 *
 * Media not read yet are not media that hold no video: the screen waits for
 * them, or says why they could not be read. A list read before stands for
 * them when a later read failed — it is what the step's screen shows too.
 */
export function recordGate(input: RecordGateInput): RecordGate {
  const { task, steps, media } = input;
  if (!input.isParsed || input.userId === null) {
    return refused(i18n.t('steps.notFound'));
  }
  if (steps.isPending || task.isPending) {
    return { kind: 'loading' };
  }
  if (steps.error !== null) {
    return { kind: 'error', error: steps.error };
  }
  const step = steps.data?.find((item) => item.id === input.stepId);
  if (step === undefined || step.type !== 'video') {
    return refused(i18n.t('steps.notFound'));
  }
  const isHers = task.data?.status === 'in_progress' && task.data.assignee_id === input.userId;
  if (!isHers) {
    return refused(i18n.t('steps.readOnly'));
  }
  if (stepState(step) !== 'pending') {
    return refused(stepStatusLine(step) ?? i18n.t('steps.readOnly'));
  }
  if (media.data === undefined) {
    return media.error !== null ? { kind: 'error', error: media.error } : { kind: 'loading' };
  }
  const videos = mediaOfStep(media.data, step.id);
  if (videos.length >= VIDEOS_PER_STEP) {
    // While it uploads, the step's tile has no «Удалить» to point her to.
    const isUploading = videos.some(
      (video) => video.uploaded_at === null && input.uploadingIds.has(video.id),
    );
    return refused(i18n.t(isUploading ? 'video.stillUploading' : 'video.alreadyRecorded'));
  }
  if (input.videoSettings === null) {
    return refused(i18n.t('steps.videoSettingsUnknown'));
  }
  return { kind: 'open', limits: videoLimits(step, input.videoSettings) };
}

function refused(text: string): RecordGate {
  return { kind: 'refused', text };
}
