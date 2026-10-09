import type { Json } from '@str-ops/shared';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { ErrorState } from '@/components/error-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { useGalleryAllowed, useVideoSettings } from '@/features/host/use-host';
import { stepAttachVariables } from '@/features/media/attach-variables';
import { capturePhoto, pickPhotoFromGallery } from '@/features/media/capture';
import { attachFailure } from '@/features/media/failure';
import { toLocalRecord, type LocalMediaRecord } from '@/features/media/local-store';
import { mediaKindOfStep, mediaOfStep, videoLimits } from '@/features/media/schema';
import {
  mediaItemViews,
  useAttachMedia,
  useFailedVideoAttach,
  useLocalMedia,
  useMediaUrls,
  useRememberLocalMedia,
  useRemoveMedia,
  useTaskMedia,
  useUploadProgress,
  useUploadingMediaIds,
  useWaitingMediaIds,
} from '@/features/media/use-media';
import { stepTitle } from '@/features/steps/format';
import { StepScreen, StepScreenSkeleton } from '@/features/steps/step-screen';
import {
  useCompleteStep,
  useOpenStep,
  useReopenStep,
  useSkipStep,
  useTaskSteps,
} from '@/features/steps/use-steps';
import { useTask } from '@/features/tasks/use-tasks';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { wordContext } from '@/i18n';

const Params = z.object({ id: z.string().uuid(), stepId: z.string().uuid() });

/**
 * One step of a task.
 *
 * Wires the hooks and decides what happens after a tap: completing or
 * skipping a step takes her back to the task — at once when the server has
 * answered, and equally when the action is queued for lack of signal, because
 * the tick is already on the screen behind her. Reopening keeps her here.
 *
 * A media step adds the camera: a capture is remembered on the phone first,
 * then handed to the upload queue, which registers, uploads and confirms it
 * whenever there is signal. The screen shows each file's progress and lets
 * her complete the step once every file has arrived. The gallery appears
 * beside the camera only where the company has allowed it, and only for
 * photos. A video is recorded on a screen of its own (`step/[stepId]/record`),
 * held to the company's numbers — and until those are known, it waits.
 */
export default function StepRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const parsed = Params.safeParse(useLocalSearchParams());
  const taskId = parsed.success ? parsed.data.id : '';
  const stepId = parsed.success ? parsed.data.stepId : '';

  const task = useTask(taskId);
  const steps = useTaskSteps(taskId);
  const open = useOpenStep();
  const complete = useCompleteStep();
  const reopen = useReopenStep();
  const skip = useSkipStep();

  const step = steps.data?.find((item) => item.id === stepId);
  const isEditable =
    task.data?.status === 'in_progress' && task.data.assignee_id === userId && userId !== null;

  const media = useTaskMedia(taskId);
  // Photos and videos queue apart: a video's minutes do not hold the photos.
  const attach = useAttachMedia();
  const attachVideo = useAttachMedia('video');
  const removeMedia = useRemoveMedia();
  const rememberLocal = useRememberLocalMedia();
  const local = useLocalMedia();
  const uploading = useUploadingMediaIds();
  // What the tiles say of a file on its way: waiting for signal, how much has gone.
  const waiting = useWaitingMediaIds();
  const progress = useUploadProgress();
  // A video is sent from the recording screen; its refusal comes back here.
  const videoAttachError = useFailedVideoAttach(stepId);
  const galleryAllowed = useGalleryAllowed();
  const videoSettings = useVideoSettings();
  const [isCapturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const stepMedia = useMemo(() => mediaOfStep(media.data ?? [], stepId), [media.data, stepId]);
  // A signed link is only worth asking for when the phone no longer has the file.
  const remotePaths = useMemo(
    () =>
      stepMedia
        .filter(
          (item) =>
            item.kind === 'photo' &&
            item.uploaded_at !== null &&
            local.data?.[item.id] === undefined,
        )
        .map((item) => item.storage_path),
    [stepMedia, local.data],
  );
  const urls = useMediaUrls(remotePaths);
  const mediaItems = useMemo(
    () =>
      mediaItemViews(stepMedia, local.data ?? {}, urls.data ?? {}, uploading, {
        waiting,
        progress,
      }),
    [stepMedia, local.data, urls.data, uploading, waiting, progress],
  );

  // The first opening is stamped once per visit, and only when there is
  // nothing stamped yet — the server keeps the first one anyway.
  const hasOpened = useRef(false);
  useEffect(() => {
    if (step !== undefined && isEditable && step.started_at === null && !hasOpened.current) {
      hasOpened.current = true;
      open.mutate({ taskId, stepId });
    }
  }, [step, isEditable, open, taskId, stepId]);

  // The camera's screen takes a moment to come up: a second tap meanwhile
  // would open a second camera over the first. Back on the step, it may open again.
  const isOpeningRecorder = useRef(false);
  useFocusEffect(
    useCallback(() => {
      isOpeningRecorder.current = false;
    }, []),
  );

  const isLeaving = complete.isSuccess || complete.isPaused || skip.isSuccess || skip.isPaused;
  useEffect(() => {
    if (isLeaving) {
      router.back();
    }
  }, [isLeaving]);

  if (!parsed.success || userId === null) {
    return <Message text={t('steps.notFound')} styles={styles} />;
  }

  if (steps.isPending || task.isPending) {
    return <StepScreenSkeleton label={t('tasks.loading', { context: wordContext() })} />;
  }

  // Steps that never loaded: the screen failed. Steps that did and only
  // failed to refresh (TanStack keeps the data beside the error) stay on
  // screen with the step she is filling in — her comment and ticks are kept —
  // and the failure is said above it.
  if (steps.error && steps.data === undefined) {
    return (
      <View style={styles.screen}>
        <ErrorState
          error={steps.error}
          title={t('common.screenFailed')}
          onRetry={() => void steps.refetch()}
        />
      </View>
    );
  }

  if (step === undefined) {
    return <Message text={t('steps.notFound')} styles={styles} />;
  }

  const onComplete = (payload: Json) => {
    complete.mutate({
      taskId,
      stepId,
      payload,
      deviceCompletedAt: new Date().toISOString(),
    });
  };

  const startUpload = (record: LocalMediaRecord) => {
    const queue = record.kind === 'video' ? attachVideo : attach;
    queue.mutate(stepAttachVariables(taskId, stepId, record));
  };

  const mediaKind = mediaKindOfStep(step.type);
  const maxVideoSec = videoSettings === null ? null : videoLimits(step, videoSettings).seconds;

  /** A video is recorded on its own screen, which hands it to the same queue. */
  const openRecorder = () => {
    if (maxVideoSec === null || isOpeningRecorder.current) {
      return;
    }
    isOpeningRecorder.current = true;
    router.push({ pathname: '/task/[id]/step/[stepId]/record', params: { id: taskId, stepId } });
  };

  /**
   * Attach a photo, from the camera or from the gallery.
   *
   * One path for both: everything after the file exists — keeping it,
   * remembering it on disk, queuing the upload — is the same, and the only
   * difference worth having is where it came from.
   */
  const attachFrom = async (source: 'camera' | 'gallery') => {
    if (mediaKind !== 'photo' || isCapturing) {
      return;
    }
    setCapturing(true);
    setNotice(null);
    try {
      const captured = source === 'gallery' ? await pickPhotoFromGallery() : await capturePhoto();
      if (captured === null) {
        return;
      }
      const record = toLocalRecord(captured);
      await rememberLocal(record);
      startUpload(record);
    } catch (error: unknown) {
      setNotice(attachFailure(error, t));
    } finally {
      setCapturing(false);
    }
  };

  const onRetryMedia = (mediaId: string) => {
    const record = local.data?.[mediaId];
    if (record !== undefined) {
      startUpload(record);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: stepTitle(step) }} />
      <StepScreen
        key={step.id}
        step={step}
        isEditable={isEditable === true}
        isBusy={complete.isPending || reopen.isPending || skip.isPending}
        refreshError={steps.error}
        error={
          complete.error ??
          reopen.error ??
          skip.error ??
          attach.error ??
          videoAttachError ??
          removeMedia.error
        }
        notice={notice}
        onComplete={onComplete}
        onReopen={() => reopen.mutate({ taskId, stepId })}
        onSkip={() => skip.mutate({ taskId, stepId })}
        media={mediaItems}
        maxVideoSec={maxVideoSec}
        isCapturing={isCapturing}
        canPickFromGallery={galleryAllowed}
        onCapture={mediaKind === 'video' ? openRecorder : () => void attachFrom('camera')}
        onPickFromGallery={() => void attachFrom('gallery')}
        onRemoveMedia={(mediaId) => removeMedia.mutate({ taskId, mediaId })}
        onRetryMedia={onRetryMedia}
      />
    </>
  );
}

interface MessageProps {
  text: string;
  styles: ReturnType<typeof createStyles>;
}

function Message({ text, styles }: MessageProps) {
  return (
    <View style={[styles.screen, styles.centered]}>
      <Text tone="secondary" align="center">
        {text}
      </Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
    },
  });
