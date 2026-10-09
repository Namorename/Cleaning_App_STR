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
  /** The task's media, the way the step's screen counts them. */
  media: readonly TaskMedia[];
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
 */
export function recordGate(input: RecordGateInput): RecordGate {
  const { task, steps } = input;
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
  if (mediaOfStep(input.media, step.id).length >= VIDEOS_PER_STEP) {
    return refused(i18n.t('video.alreadyRecorded'));
  }
  if (input.videoSettings === null) {
    return refused(i18n.t('steps.videoSettingsUnknown'));
  }
  return { kind: 'open', limits: videoLimits(step, input.videoSettings) };
}

function refused(text: string): RecordGate {
  return { kind: 'refused', text };
}
