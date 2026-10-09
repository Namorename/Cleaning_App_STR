import { CameraView, type CameraRecordingOptions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import type { Recording } from '@/features/media/capture';
import { discardFile } from '@/features/media/file';
import type { VideoLimits } from '@/features/media/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { reportError } from '@/lib/sentry';

import { RecordButton } from './record-button';
import { announcedSecondsLeft, clockText, measuredSeconds, secondsLeft } from './recording';

/** How often the countdown is redrawn: often enough that it never skips a second. */
const TICK_MS = 250;
/**
 * The camera stops at the limit itself; the screen stops it a moment later in
 * case it did not. The server allows 2 s over the limit, and the length
 * declared is capped at the limit either way.
 */
const STOP_GRACE_MS = 1000;
const MS_PER_SECOND = 1000;

/**
 * On an iPhone the bitrate holds only with an explicit codec, and H.264 plays
 * where HEVC may not — in Chrome on the office's Windows (docs/tech-plan.md
 * §7.1). Android records H.264 as it is.
 */
const PLATFORM_OPTIONS: Partial<CameraRecordingOptions> =
  Platform.OS === 'ios' ? { codec: 'avc1' } : {};

export interface VideoRecorderProps {
  limits: VideoLimits;
  /** A finished recording, with the length this screen measured. */
  onRecorded: (recording: Recording) => void;
}

/**
 * The camera, a countdown and one button.
 *
 * The camera writes the file and reports only where it is; the length is
 * timed here, from the moment the recording is asked for to the moment it is
 * stopped. The countdown is drawn every quarter second and said to a screen
 * reader every ten. Leaving the screen mid-recording stops the camera and
 * keeps nothing.
 */
export function VideoRecorder({ limits, onRecorded }: VideoRecorderProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const camera = useRef<CameraView>(null);
  const [isReady, setReady] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  /** The camera recording right now, kept past the moment the view goes away. */
  const recordingCamera = useRef<CameraView | null>(null);
  const stoppedAt = useRef<number | null>(null);
  const isMounted = useRef(false);

  const elapsedMs = startedAt === null ? 0 : now - startedAt;
  const left = secondsLeft(elapsedMs, limits.seconds);
  const announced = announcedSecondsLeft(elapsedMs, limits.seconds);
  const announcement = t('video.remaining', { count: announced });

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      recordingCamera.current?.stopRecording();
    };
  }, []);

  // Refs only, so the same function for the whole life of the screen.
  const stop = useCallback(() => {
    if (recordingCamera.current === null || stoppedAt.current !== null) {
      return;
    }
    stoppedAt.current = Date.now();
    recordingCamera.current.stopRecording();
  }, []);

  // The countdown, and the stop the camera should have made itself.
  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current - startedAt >= limits.seconds * MS_PER_SECOND + STOP_GRACE_MS) {
        stop();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [startedAt, limits.seconds, stop]);

  // Android reads the live region below as it changes; an iPhone has none.
  useEffect(() => {
    if (startedAt !== null && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [announcement, startedAt]);

  const record = async () => {
    const view = camera.current;
    if (view === null || !isReady || recordingCamera.current !== null) {
      return;
    }
    const started = Date.now();
    recordingCamera.current = view;
    stoppedAt.current = null;
    setStartedAt(started);
    setNow(started);
    try {
      const result = await view.recordAsync({
        maxDuration: limits.seconds,
        maxFileSize: limits.maxBytes,
        ...PLATFORM_OPTIONS,
      });
      const ended = stoppedAt.current ?? Date.now();
      recordingCamera.current = null;
      if (!isMounted.current) {
        if (result !== undefined) {
          discardFile(result.uri);
        }
        return;
      }
      setStartedAt(null);
      if (result === undefined) {
        return;
      }
      onRecorded({
        uri: result.uri,
        durationSec: measuredSeconds(started, ended, limits.seconds),
        takenAt: new Date(started).toISOString(),
      });
    } catch (error: unknown) {
      recordingCamera.current = null;
      reportError(error);
      if (isMounted.current) {
        setStartedAt(null);
      }
    }
  };

  const isRecording = startedAt !== null;

  return (
    <View style={styles.screen}>
      <CameraView
        ref={camera}
        style={layout.camera}
        facing="back"
        mode="video"
        videoQuality="720p"
        videoBitrate={limits.bitrate}
        onCameraReady={() => setReady(true)}
      />
      <View style={styles.controls}>
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
          isDisabled={!isReady}
          onPress={isRecording ? stop : () => void record()}
        />
      </View>
    </View>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  camera: { flex: 1 },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    controls: {
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.lg,
      backgroundColor: theme.background,
    },
  });
