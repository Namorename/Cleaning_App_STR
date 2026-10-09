import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useVideoSettings } from '@/features/host/use-host';
import { stepAttachVariables } from '@/features/media/attach-variables';
import { keepRecording, type Recording } from '@/features/media/capture';
import { toLocalRecord } from '@/features/media/local-store';
import { videoLimits } from '@/features/media/schema';
import { useAttachMedia, useRememberLocalMedia } from '@/features/media/use-media';
import { useTaskSteps } from '@/features/steps/use-steps';
import { RecordScreen } from '@/features/video/record-screen';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({ id: z.string().uuid(), stepId: z.string().uuid() });

/**
 * The recording screen of a task's video step (docs/tech-plan.md §7.1).
 *
 * Wires the step and the company's numbers to the camera, and hands what was
 * recorded to the same queue as a photo of the step: kept on the phone,
 * remembered on disk, then registered, uploaded and confirmed whenever there
 * is signal. Without the company's numbers it records nothing — the step's
 * screen holds its button for the same reason.
 */
export default function RecordRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const parsed = Params.safeParse(useLocalSearchParams());
  const taskId = parsed.success ? parsed.data.id : '';
  const stepId = parsed.success ? parsed.data.stepId : '';

  const steps = useTaskSteps(taskId);
  const videoSettings = useVideoSettings();
  const attach = useAttachMedia();
  const rememberLocal = useRememberLocalMedia();

  const step = steps.data?.find((item) => item.id === stepId);

  if (!parsed.success) {
    return <Message text={t('steps.notFound')} styles={styles} />;
  }

  if (steps.isPending) {
    return <LoadingState label={t('video.starting')} />;
  }

  if (steps.error) {
    return (
      <View style={styles.screen}>
        <ErrorState error={steps.error} />
      </View>
    );
  }

  if (step === undefined || step.type !== 'video') {
    return <Message text={t('steps.notFound')} styles={styles} />;
  }

  if (videoSettings === null) {
    return <Message text={t('steps.videoSettingsUnknown')} styles={styles} />;
  }

  const send = async (recording: Recording) => {
    const captured = await keepRecording(recording);
    const record = toLocalRecord(captured);
    await rememberLocal(record);
    attach.mutate(stepAttachVariables(taskId, stepId, record));
    router.back();
  };

  return <RecordScreen limits={videoLimits(step, videoSettings)} onSend={send} />;
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
