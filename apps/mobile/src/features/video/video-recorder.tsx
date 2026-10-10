import { CameraView } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useScreenEdgePadding } from '@/components/bottom-inset';
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
 * second and said to a screen reader every ten while it records. Between
 * «Стоп» and the file the button is greyed and says «Сохраняем…», said once to
 * the reader, the countdown quiet: the camera is still writing.
 */
export function VideoRecorder({ limits, onRecorded }: VideoRecorderProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  // «Записать» clears the system's bar (components/bottom-inset.ts).
  const end = useScreenEdgePadding(Spacing.lg);
  const camera = useRef<CameraView>(null);
  const recording = useVideoRecording(camera, limits, onRecorded);
  const { elapsedMs, isRecording, isSaving } = recording;

  const left = secondsLeft(elapsedMs, limits.seconds);
  const announcement = t('video.remaining', {
    count: announcedSecondsLeft(elapsedMs, limits.seconds),
  });

  // Android reads the live region below as it changes; an iPhone has none.
  // Only while it records: once «Стоп» is pressed the countdown is over.
  useEffect(() => {
    if (isRecording && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [announcement, isRecording]);

  // The camera still writing the file is said once, as it begins: the button
  // greys and says so, but a reader whose focus is elsewhere would not hear
  // it (item 5 of the verification review of f3217a7..c466bf5).
  const saving = t('video.saving');
  useEffect(() => {
    if (isSaving) {
      AccessibilityInfo.announceForAccessibility(saving);
    }
  }, [isSaving, saving]);

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
      <ScrollView style={styles.panel} contentContainerStyle={[layout.controls, end]}>
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
        {/* Quiet while the file is saved: the time left no longer counts down. */}
        <Text
          tone="secondary"
          align="center"
          accessibilityLiveRegion={isSaving ? 'none' : 'polite'}
        >
          {announcement}
        </Text>
        <RecordButton
          isRecording={isRecording}
          isSaving={isSaving}
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
