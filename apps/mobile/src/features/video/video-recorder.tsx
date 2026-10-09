import { CameraView } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { ErrorState } from '@/components/error-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import type { Recording } from '@/features/media/capture';
import type { VideoLimits } from '@/features/media/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { RecordButton } from './record-button';
import { announcedSecondsLeft, clockText, secondsLeft, type RecordingEnd } from './recording';
import { RecorderNotice } from './recorder-notice';
import { useVideoRecording } from './use-video-recording';

export interface VideoRecorderProps {
  limits: VideoLimits;
  /** A finished recording, with the length this screen measured and what ended it. */
  onRecorded: (recording: Recording, end: RecordingEnd) => void;
}

/**
 * The camera, a countdown and one button.
 *
 * The recording itself — its timing, its stops and what can go wrong — is
 * `useVideoRecording`'s; this draws it. The countdown is drawn every quarter
 * second and said to a screen reader every ten. Between «Стоп» and the file
 * the button is greyed: the camera is still writing.
 */
export function VideoRecorder({ limits, onRecorded }: VideoRecorderProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const camera = useRef<CameraView>(null);
  const recording = useVideoRecording(camera, limits, onRecorded);
  const { elapsedMs, isRecording, isSaving } = recording;
  const isRunning = isRecording || isSaving;

  const left = secondsLeft(elapsedMs, limits.seconds);
  const announcement = t('video.remaining', {
    count: announcedSecondsLeft(elapsedMs, limits.seconds),
  });

  // Android reads the live region below as it changes; an iPhone has none.
  useEffect(() => {
    if (isRunning && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [announcement, isRunning]);

  if (recording.failure !== null) {
    return (
      <View style={styles.screen}>
        <ErrorState
          title={t(recording.failure.titleKey)}
          error={recording.failure.error}
          onRetry={recording.retry}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView
        key={recording.cameraKey}
        ref={camera}
        style={layout.camera}
        facing="back"
        mode="video"
        videoQuality="720p"
        videoBitrate={limits.bitrate}
        onCameraReady={recording.onCameraReady}
        onMountError={recording.onMountError}
      />
      {/* At the largest font the panel scrolls and the camera's view shrinks. */}
      <ScrollView style={styles.panel} contentContainerStyle={layout.controls}>
        {recording.trouble !== null ? <RecorderNotice trouble={recording.trouble} /> : null}
        {/* The clock is for the eye; the reader hears the words under it. */}
        <Text
          variant="display"
          align="center"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {clockText(left)}
        </Text>
        <Text tone="secondary" align="center" accessibilityLiveRegion="polite">
          {announcement}
        </Text>
        <RecordButton
          isRecording={isRecording}
          isDisabled={!recording.isReady || isSaving}
          onPress={isRecording ? recording.stop : () => void recording.record()}
        />
      </ScrollView>
    </View>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  camera: { flex: 1 },
  controls: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.lg },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    panel: { flexGrow: 0, backgroundColor: theme.background },
  });
