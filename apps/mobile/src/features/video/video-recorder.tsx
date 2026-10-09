import { CameraView, type CameraRecordingOptions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, AppState, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { ErrorState } from '@/components/error-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import type { Recording } from '@/features/media/capture';
import { discardFile } from '@/features/media/file';
import type { VideoLimits } from '@/features/media/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { reportError } from '@/lib/sentry';

import { freeDiskBytes } from './disk-space';
import { RecordButton } from './record-button';
import {
  announcedSecondsLeft,
  clockText,
  measuredSeconds,
  secondsLeft,
  type RecordingEnd,
} from './recording';
import { RecorderNotice, type Trouble } from './recorder-notice';

/** How often the countdown is redrawn: often enough that it never skips a second. */
const TICK_MS = 250;
/**
 * The camera stops at the limit itself; the screen stops it a moment later in
 * case it did not. The server allows 2 s over the limit, and the length
 * declared is capped at the limit either way.
 */
const STOP_GRACE_MS = 1000;
const MS_PER_SECOND = 1000;
/** Room asked for before a recording: the size limit and a fifth more. */
const SPACE_FACTOR = 1.2;
/** A recording cut off by the app going away is kept only from a second up. */
const MIN_KEPT_SEC = 1;

/**
 * On an iPhone the bitrate holds only with an explicit codec, and H.264 plays
 * where HEVC may not — in Chrome on the office's Windows (docs/tech-plan.md
 * §7.1). Android records H.264 as it is.
 */
const PLATFORM_OPTIONS: Partial<CameraRecordingOptions> =
  Platform.OS === 'ios' ? { codec: 'avc1' } : {};

/** A camera that would not start, or a recording that failed: the title and the cause. */
interface Failure {
  titleKey: 'video.cameraFailed' | 'video.recordFailed';
  error: unknown;
}

export interface VideoRecorderProps {
  limits: VideoLimits;
  /** A finished recording, with the length this screen measured and what ended it. */
  onRecorded: (recording: Recording, end: RecordingEnd) => void;
}

/**
 * The camera, a countdown and one button.
 *
 * The camera writes the file and reports only where it is; the length is
 * timed here, from the moment the recording is asked for to the moment it is
 * stopped. The countdown is drawn every quarter second and said to a screen
 * reader every ten. A recording starts only with room for the largest file it
 * may write; it stops when the app is put away, and what it caught goes to the
 * preview unless it is under a second. Leaving the screen mid-recording stops
 * the camera and keeps nothing.
 */
export function VideoRecorder({ limits, onRecorded }: VideoRecorderProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const camera = useRef<CameraView>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [isReady, setReady] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  /** The camera recording right now, kept past the moment the view goes away. */
  const recordingCamera = useRef<CameraView | null>(null);
  const stoppedAt = useRef<number | null>(null);
  const endedBy = useRef<RecordingEnd | null>(null);
  const isInBackground = useRef(false);
  const isMounted = useRef(false);

  const elapsedMs = startedAt === null ? 0 : now - startedAt;
  const left = secondsLeft(elapsedMs, limits.seconds);
  const announcement = t('video.remaining', {
    count: announcedSecondsLeft(elapsedMs, limits.seconds),
  });

  // Refs only, so the same function for the whole life of the screen.
  const stop = useCallback((end: RecordingEnd) => {
    if (recordingCamera.current === null || stoppedAt.current !== null) {
      return;
    }
    stoppedAt.current = Date.now();
    endedBy.current = end;
    recordingCamera.current.stopRecording();
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      recordingCamera.current?.stopRecording();
    };
  }, []);

  // Put away, the camera goes dark anyway: stop while the file is still good.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      isInBackground.current = state === 'background';
      if (state === 'background') {
        stop('background');
      }
    });
    return () => subscription.remove();
  }, [stop]);

  // The countdown, and the stop the camera should have made itself.
  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current - startedAt >= limits.seconds * MS_PER_SECOND + STOP_GRACE_MS) {
        stop('limit');
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

  /** Room for the largest file the recording may write, and a fifth more. */
  const hasRoom = (): boolean => {
    const free = freeDiskBytes();
    const needed = Math.round(limits.maxBytes * SPACE_FACTOR);
    if (free !== null && free < needed) {
      setTrouble({ kind: 'lowSpace', neededBytes: needed, freeBytes: free });
      return false;
    }
    return true;
  };

  /** What the camera handed back, once it has stopped. */
  const finish = (uri: string | undefined, started: number) => {
    const ended = stoppedAt.current ?? Date.now();
    // Stopped by nobody here: the camera reached its length or size limit —
    // unless the app was put away before this screen could say so.
    const end = endedBy.current ?? (isInBackground.current ? 'background' : 'limit');
    if (uri === undefined) {
      setFailure({
        titleKey: 'video.recordFailed',
        error: new Error('The camera returned no file'),
      });
      return;
    }
    const durationSec = measuredSeconds(started, ended, limits.seconds);
    if (end === 'background' && durationSec < MIN_KEPT_SEC) {
      discardFile(uri);
      setTrouble({ kind: 'cutShort' });
      return;
    }
    onRecorded({ uri, durationSec, takenAt: new Date(started).toISOString() }, end);
  };

  const record = async () => {
    const view = camera.current;
    if (view === null || !isReady || recordingCamera.current !== null || !hasRoom()) {
      return;
    }
    const started = Date.now();
    recordingCamera.current = view;
    stoppedAt.current = null;
    endedBy.current = null;
    setTrouble(null);
    setStartedAt(started);
    setNow(started);
    try {
      const result = await view.recordAsync({
        maxDuration: limits.seconds,
        maxFileSize: limits.maxBytes,
        ...PLATFORM_OPTIONS,
      });
      recordingCamera.current = null;
      if (!isMounted.current) {
        if (result !== undefined) {
          discardFile(result.uri);
        }
        return;
      }
      setStartedAt(null);
      finish(result?.uri, started);
    } catch (error: unknown) {
      recordingCamera.current = null;
      reportError(error);
      if (isMounted.current) {
        setStartedAt(null);
        setFailure({ titleKey: 'video.recordFailed', error });
      }
    }
  };

  const retry = () => {
    setFailure(null);
    setReady(false);
    setCameraKey((key) => key + 1);
  };

  if (failure !== null) {
    return (
      <View style={styles.screen}>
        <ErrorState title={t(failure.titleKey)} error={failure.error} onRetry={retry} />
      </View>
    );
  }

  const isRecording = startedAt !== null;

  return (
    <View style={styles.screen}>
      <CameraView
        key={cameraKey}
        ref={camera}
        style={layout.camera}
        facing="back"
        mode="video"
        videoQuality="720p"
        videoBitrate={limits.bitrate}
        onCameraReady={() => setReady(true)}
        onMountError={({ message }) =>
          setFailure({ titleKey: 'video.cameraFailed', error: new Error(message) })
        }
      />
      {/* At the largest font the panel scrolls and the camera's view shrinks. */}
      <ScrollView style={styles.panel} contentContainerStyle={layout.controls}>
        {trouble !== null ? <RecorderNotice trouble={trouble} /> : null}
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
          onPress={isRecording ? () => stop('stop') : () => void record()}
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
