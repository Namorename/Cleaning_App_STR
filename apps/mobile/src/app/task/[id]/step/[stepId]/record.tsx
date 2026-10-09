import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { useVideoSettings } from '@/features/host/use-host';
import { stepAttachVariables } from '@/features/media/attach-variables';
import type { CapturedMedia } from '@/features/media/capture';
import { toLocalRecord } from '@/features/media/local-store';
import type { VideoLimits } from '@/features/media/schema';
import {
  useAttachMedia,
  useRememberLocalMedia,
  useTaskMedia,
  useUploadingMediaIds,
} from '@/features/media/use-media';
import { useTaskSteps } from '@/features/steps/use-steps';
import { useTask } from '@/features/tasks/use-tasks';
import { recordGate } from '@/features/video/record-gate';
import { RecordScreen } from '@/features/video/record-screen';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({ id: z.string().uuid(), stepId: z.string().uuid() });

/**
 * The recording screen of a task's video step (docs/tech-plan.md §7.1).
 *
 * Wires the step and the company's numbers to the camera, and hands what was
 * recorded to the same queue as a photo of the step: kept on the phone,
 * remembered on disk, then registered, uploaded and confirmed whenever there
 * is signal.
 *
 * It opens the camera only where the step's own button would have: her task,
 * under way, the step still to do, its one video not yet taken, the
 * company's numbers known — and otherwise says why, in the step's words. Once
 * open, the camera stays: the video she sends lands in the step's list before
 * the screen is gone, and is not a reason to take the camera from under her.
 */
export default function RecordRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const parsed = Params.safeParse(useLocalSearchParams());
  const taskId = parsed.success ? parsed.data.id : '';
  const stepId = parsed.success ? parsed.data.stepId : '';

  const task = useTask(taskId);
  const steps = useTaskSteps(taskId);
  const media = useTaskMedia(taskId);
  const uploadingIds = useUploadingMediaIds();
  const videoSettings = useVideoSettings();
  const attach = useAttachMedia('video');
  const rememberLocal = useRememberLocalMedia();
  /** The limits the camera opened with; from then on the gate is not asked again. */
  const [openedWith, setOpenedWith] = useState<VideoLimits | null>(null);

  const gate =
    openedWith === null
      ? recordGate({
          isParsed: parsed.success,
          userId,
          stepId,
          task,
          steps,
          media,
          uploadingIds,
          videoSettings,
        })
      : null;
  const limits = openedWith ?? (gate?.kind === 'open' ? gate.limits : null);

  // Latched in the render that opens it: state adjusted while rendering, no effect.
  if (openedWith === null && limits !== null) {
    setOpenedWith(limits);
  }

  const send = async (captured: CapturedMedia) => {
    const record = toLocalRecord(captured);
    await rememberLocal(record);
    attach.mutate(stepAttachVariables(taskId, stepId, record));
  };

  if (limits !== null) {
    return <RecordScreen limits={limits} onSend={send} onDone={goBack} />;
  }

  if (gate?.kind === 'error') {
    return (
      <View style={styles.screen}>
        <ErrorState error={gate.error} />
      </View>
    );
  }

  if (gate?.kind === 'refused') {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text tone="secondary" align="center">
          {gate.text}
        </Text>
      </View>
    );
  }

  return <LoadingState label={t('video.starting')} />;
}

/** Back to the step, once the recording is the queue's. */
function goBack(): void {
  router.back();
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
