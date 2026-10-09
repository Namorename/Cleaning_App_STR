import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import type { Recording } from '@/features/media/capture';
import { attachFailure } from '@/features/media/failure';
import type { VideoLimits } from '@/features/media/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { reportError } from '@/lib/sentry';

import { PermissionScreen } from './permission-screen';
import { useRecordingPermissions } from './use-recording-permissions';
import { VideoRecorder } from './video-recorder';

export interface RecordScreenProps {
  limits: VideoLimits;
  /** Keep the recording and hand it to the upload queue; throws when it could not. */
  onSend: (recording: Recording) => Promise<void>;
}

/**
 * A video step's recording, from the phone's permission to the queue.
 *
 * Nothing is drawn over the camera until the phone has granted both it and
 * the microphone; what it refuses is said on a screen of its own.
 */
export function RecordScreen({ limits, onSend }: RecordScreenProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const permissions = useRecordingPermissions();
  const [failure, setFailure] = useState<string | null>(null);

  if (permissions.isChecking) {
    return <LoadingState label={t('video.starting')} />;
  }

  if (permissions.missing.length > 0) {
    return (
      <PermissionScreen
        missing={permissions.missing}
        canAsk={permissions.canAsk}
        onAsk={() => {
          permissions.ask().catch(reportError);
        }}
      />
    );
  }

  const send = async (recording: Recording) => {
    setFailure(null);
    try {
      await onSend(recording);
    } catch (error: unknown) {
      setFailure(attachFailure(error, t));
    }
  };

  return (
    <View style={styles.screen}>
      <VideoRecorder limits={limits} onRecorded={(recording) => void send(recording)} />
      {failure !== null ? (
        <Text tone="danger" align="center" accessibilityLiveRegion="polite" style={layout.failure}>
          {failure}
        </Text>
      ) : null}
    </View>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  failure: { padding: Spacing.md },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
