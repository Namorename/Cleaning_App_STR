import type { Json } from '@str-ops/shared';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { CameraDeniedError, capturePhoto, captureVideo } from '@/features/media/capture';
import { toLocalRecord, type LocalMediaRecord } from '@/features/media/local-store';
import { mediaKindOfStep, mediaOfStep, videoLimitSec } from '@/features/media/schema';
import {
  mediaItemViews,
  useAttachMedia,
  useLocalMedia,
  useMediaUrls,
  useRememberLocalMedia,
  useRemoveMedia,
  useTaskMedia,
  useUploadingMediaIds,
} from '@/features/media/use-media';
import { stepTitle } from '@/features/steps/format';
import { StepScreen } from '@/features/steps/step-screen';
import {
  useCompleteStep,
  useOpenStep,
  useReopenStep,
  useSkipStep,
  useTaskSteps,
} from '@/features/steps/use-steps';
import { useTask } from '@/features/tasks/use-tasks';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

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
 * her complete the step once every file has arrived.
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
  const attach = useAttachMedia();
  const removeMedia = useRemoveMedia();
  const rememberLocal = useRememberLocalMedia();
  const local = useLocalMedia();
  const uploading = useUploadingMediaIds();
  const [isCapturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const stepMedia = useMemo(() => mediaOfStep(media.data ?? [], stepId), [media.data, stepId]);
  // A signed link is only worth asking for when the phone no longer has the file.
  const remotePaths = useMemo(
    () =>
      stepMedia
        .filter((item) => item.uploaded_at !== null && local.data?.[item.id] === undefined)
        .map((item) => item.storage_path),
    [stepMedia, local.data],
  );
  const urls = useMediaUrls(remotePaths);
  const mediaItems = useMemo(
    () => mediaItemViews(stepMedia, local.data ?? {}, urls.data ?? {}, uploading),
    [stepMedia, local.data, urls.data, uploading],
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
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('tasks.loading')}</Text>
      </View>
    );
  }

  if (steps.error) {
    const failure = serverErrorText(steps.error);
    return <Message text={failure.text} detail={failure.detail} styles={styles} />;
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
    attach.mutate({
      taskId,
      stepId,
      uri: record.uri,
      mediaId: record.id,
      kind: record.kind,
      mimeType: record.mimeType,
      byteSize: record.byteSize,
      width: record.width,
      height: record.height,
      durationSec: record.durationSec,
      takenAt: record.takenAt,
    });
  };

  const onCapture = async () => {
    const kind = mediaKindOfStep(step.type);
    if (kind === null || isCapturing) {
      return;
    }
    setCapturing(true);
    setNotice(null);
    try {
      const captured =
        kind === 'video' ? await captureVideo(videoLimitSec(step)) : await capturePhoto();
      if (captured === null) {
        return;
      }
      const record = toLocalRecord(captured);
      await rememberLocal(record);
      startUpload(record);
    } catch (error: unknown) {
      setNotice(
        error instanceof CameraDeniedError ? t('steps.cameraDenied') : t('steps.captureFailed'),
      );
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
        error={
          complete.error ?? reopen.error ?? skip.error ?? attach.error ?? removeMedia.error
        }
        notice={notice}
        onComplete={onComplete}
        onReopen={() => reopen.mutate({ taskId, stepId })}
        onSkip={() => skip.mutate({ taskId, stepId })}
        media={mediaItems}
        isCapturing={isCapturing}
        onCapture={() => void onCapture()}
        onRemoveMedia={(mediaId) => removeMedia.mutate({ taskId, mediaId })}
        onRetryMedia={onRetryMedia}
      />
    </>
  );
}

interface MessageProps {
  text: string;
  /** The server's own words, when we had no translation for them. */
  detail?: string | null;
  styles: ReturnType<typeof createStyles>;
}

function Message({ text, detail = null, styles }: MessageProps) {
  return (
    <View style={styles.centered}>
      <Text style={styles.message}>{text}</Text>
      {detail !== null ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.xl,
      backgroundColor: theme.background,
    },
    message: { fontSize: FontSize.body, color: theme.textSecondary, textAlign: 'center' },
    detail: { fontSize: FontSize.caption, color: theme.textSecondary, textAlign: 'center' },
  });
