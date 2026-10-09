import type { CameraRecordingOptions, CameraView } from 'expo-camera';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AppState, Platform } from 'react-native';

import type { Recording } from '@/features/media/capture';
import { discardFile, fileSize } from '@/features/media/file';
import type { VideoLimits } from '@/features/media/schema';
import { reportError } from '@/lib/sentry';

import { freeDiskBytes } from './disk-space';
import { cameraEnd, measuredSeconds, type RecordingEnd } from './recording';
import type { Trouble } from './recorder-notice';

/** How often the countdown is redrawn: often enough that it never skips a second. */
const TICK_MS = 250;
/**
 * The camera stops at the limit itself; the screen stops it a moment later in
 * case it did not. The server allows 2 s over the limit, and the length
 * declared is capped at the limit either way.
 */
const STOP_GRACE_MS = 1000;
/** A stop the camera has not answered with its file is said again this often. */
const STOP_RETRY_MS = 2000;
/** After this many stops without a file the camera is given up on, not waited for. */
const MAX_STOP_ATTEMPTS = 4;
const MS_PER_SECOND = 1000;
/** Room asked for before a recording: the size limit and a fifth more. */
const SPACE_FACTOR = 1.2;
/** A recording cut off by the app going away is kept only from a second up. */
const MIN_KEPT_SEC = 1;
/**
 * The screen's own lock against sleep while a recording runs: a phone that
 * locks after half a minute untouched would otherwise cut a longer one.
 */
const KEEP_AWAKE_TAG = 'video-recording';

/** Let the screen sleep again; a lock already released is not an error. */
function releaseScreen(): void {
  deactivateKeepAwake(KEEP_AWAKE_TAG).catch(reportError);
}

/**
 * Let the screen sleep once the lock asked for is in place, or refused. The
 * lock is taken asynchronously: let go before then, it would be taken after —
 * a recording refused at once would leave the screen on with nothing to stop
 * it.
 */
function releaseScreenAfter(lock: Promise<void> | null): void {
  if (lock === null) {
    releaseScreen();
    return;
  }
  void lock.finally(releaseScreen);
}

/**
 * On an iPhone the bitrate holds only with an explicit codec, and H.264 plays
 * where HEVC may not — in Chrome on the office's Windows (docs/tech-plan.md
 * §7.1). Android records H.264 as it is.
 */
const PLATFORM_OPTIONS: Partial<CameraRecordingOptions> =
  Platform.OS === 'ios' ? { codec: 'avc1' } : {};

/** A camera that would not start, or a recording that failed: the title and the cause. */
export interface RecorderFailure {
  titleKey: 'video.cameraFailed' | 'video.recordFailed';
  error: unknown;
}

export interface VideoRecording {
  /** The key of the camera's view: a fresh one is mounted after a failure. */
  cameraKey: number;
  isReady: boolean;
  onCameraReady: () => void;
  onMountError: (event: { message: string }) => void;
  /** Recording, and «Стоп» still to be pressed. */
  isRecording: boolean;
  /** Stopped, the camera still writing the file: nothing else starts meanwhile. */
  isSaving: boolean;
  /** Time recorded so far, held still once stopped. */
  elapsedMs: number;
  trouble: Trouble | null;
  failure: RecorderFailure | null;
  record: () => Promise<void>;
  stop: () => void;
  /** After a failure: a fresh camera. */
  retry: () => void;
}

interface Run {
  /** Which recording this is: one given up on is not the screen's any more. */
  number: number;
  stoppedAt: number | null;
  endedBy: RecordingEnd | null;
  stopAttempts: number;
  lastStopAt: number;
}

/**
 * A recording, from «Записать» to the file — or to why there is none.
 *
 * The camera writes the file and reports only where it is; the length is
 * timed here, from the moment the recording is asked for to the moment it is
 * stopped. A recording starts only with room for the largest file it may
 * write, and keeps the screen awake while it runs. It stops when the app is
 * put away, when another screen covers it and when she leaves — as she
 * leaves, while the camera's view is still there to stop; a camera stopped on
 * the way out may answer with an error, and that is not a fault to report.
 * After «Стоп» nothing else starts until the file is in; a stop the camera
 * did not answer is said again, and a camera that never answers ends in a
 * failure rather than a frozen button.
 */
export function useVideoRecording(
  camera: RefObject<CameraView | null>,
  limits: VideoLimits,
  onRecorded: (recording: Recording, end: RecordingEnd) => void,
): VideoRecording {
  const navigation = useNavigation();
  const [cameraKey, setCameraKey] = useState(0);
  const [isReady, setReady] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [failure, setFailure] = useState<RecorderFailure | null>(null);
  /** The camera recording right now, kept past the moment the view goes away. */
  const recordingCamera = useRef<CameraView | null>(null);
  const run = useRef<Run>({
    number: 0,
    stoppedAt: null,
    endedBy: null,
    stopAttempts: 0,
    lastStopAt: 0,
  });
  const isInBackground = useRef(false);
  const isLeaving = useRef(false);
  const isMounted = useRef(false);
  /** The lock against sleep asked for by the recording under way; settles either way. */
  const screenLock = useRef<Promise<void> | null>(null);

  // Refs only, so the same function for the whole life of the screen. A
  // second call says the stop again; the first one's time and cause stand.
  const stopWith = useCallback((end: RecordingEnd) => {
    const view = recordingCamera.current;
    if (view === null) {
      return;
    }
    const current = run.current;
    if (current.stoppedAt === null) {
      const stopped = Date.now();
      run.current = { ...current, stoppedAt: stopped, endedBy: end };
      setStoppedAt(stopped);
    }
    run.current = {
      ...run.current,
      stopAttempts: run.current.stopAttempts + 1,
      lastStopAt: Date.now(),
    };
    view.stopRecording();
  }, []);

  /** A camera that never handed the file over: what it hands later is nobody's. */
  const giveUp = useCallback(() => {
    run.current = { ...run.current, number: run.current.number + 1 };
    recordingCamera.current = null;
    const error = new Error('The camera did not hand the recording over');
    reportError(error);
    setStartedAt(null);
    setStoppedAt(null);
    setFailure({ titleKey: 'video.recordFailed', error });
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // Normally stopped as she left; this is for a screen gone any other way.
      if (run.current.stoppedAt === null) {
        recordingCamera.current?.stopRecording();
      }
    };
  }, []);

  // Leaving, or covered by another screen: stop while the camera's view exists.
  useEffect(() => {
    const offRemove = navigation.addListener('beforeRemove', () => {
      isLeaving.current = true;
      stopWith('interrupted');
    });
    const offBlur = navigation.addListener('blur', () => stopWith('interrupted'));
    return () => {
      offRemove();
      offBlur();
    };
  }, [navigation, stopWith]);

  // Put away, the camera goes dark anyway: stop while the file is still good.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      isInBackground.current = state === 'background';
      if (state === 'background') {
        releaseScreenAfter(screenLock.current);
        stopWith('background');
      }
    });
    return () => subscription.remove();
  }, [stopWith]);

  // Awake from the moment a recording starts until it is over, or the screen is gone.
  const isRunning = startedAt !== null;
  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const lock = activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(reportError);
    screenLock.current = lock;
    return () => {
      screenLock.current = null;
      releaseScreenAfter(lock);
    };
  }, [isRunning]);

  // The countdown, the stop the camera should have made itself, and a stop said again.
  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const timer = setInterval(() => {
      const current = Date.now();
      const { stoppedAt: stopped, stopAttempts, lastStopAt, endedBy } = run.current;
      if (stopped === null) {
        setNow(current);
        if (current - startedAt >= limits.seconds * MS_PER_SECOND + STOP_GRACE_MS) {
          stopWith('limit');
        }
      } else if (current - lastStopAt >= STOP_RETRY_MS) {
        if (stopAttempts >= MAX_STOP_ATTEMPTS) {
          giveUp();
        } else {
          stopWith(endedBy ?? 'stop');
        }
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [startedAt, limits.seconds, stopWith, giveUp]);

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

  /** What ended a recording nobody here stopped: the app put away, a limit, or neither. */
  const endOfCamera = async (uri: string, durationSec: number): Promise<RecordingEnd> => {
    if (isInBackground.current) {
      return 'background';
    }
    const bytes = await fileSize(uri).catch(() => null);
    return cameraEnd(durationSec, limits.seconds, bytes, limits.cameraMaxBytes);
  };

  /** What the camera handed back, once it has stopped. */
  const finish = async (uri: string | undefined, started: number): Promise<void> => {
    const ended = run.current.stoppedAt ?? Date.now();
    if (uri === undefined) {
      const error = new Error('The camera returned no file');
      reportError(error);
      setStartedAt(null);
      setStoppedAt(null);
      setFailure({ titleKey: 'video.recordFailed', error });
      return;
    }
    const durationSec = measuredSeconds(started, ended, limits.seconds);
    const end = run.current.endedBy ?? (await endOfCamera(uri, durationSec));
    if (!isMounted.current || isLeaving.current) {
      discardFile(uri);
      return;
    }
    setStartedAt(null);
    setStoppedAt(null);
    if (end === 'background' && durationSec < MIN_KEPT_SEC) {
      discardFile(uri);
      setTrouble({ kind: 'cutShort' });
      return;
    }
    onRecorded({ uri, durationSec, takenAt: new Date(started).toISOString() }, end);
  };

  const record = async (): Promise<void> => {
    const view = camera.current;
    if (view === null || !isReady || recordingCamera.current !== null || !hasRoom()) {
      return;
    }
    const started = Date.now();
    const number = run.current.number + 1;
    run.current = { number, stoppedAt: null, endedBy: null, stopAttempts: 0, lastStopAt: 0 };
    recordingCamera.current = view;
    setTrouble(null);
    setStoppedAt(null);
    setStartedAt(started);
    setNow(started);
    try {
      const result = await view.recordAsync({
        maxDuration: limits.seconds,
        maxFileSize: limits.cameraMaxBytes,
        ...PLATFORM_OPTIONS,
      });
      if (number !== run.current.number || !isMounted.current) {
        // Given up on, or the screen is gone: the file is nobody's.
        if (result !== undefined) {
          discardFile(result.uri);
        }
        return;
      }
      recordingCamera.current = null;
      await finish(result?.uri, started);
    } catch (error: unknown) {
      if (number !== run.current.number) {
        return;
      }
      recordingCamera.current = null;
      // Stopped as she left, the camera may refuse with an error of its own.
      if (!isMounted.current || isLeaving.current) {
        return;
      }
      reportError(error);
      setStartedAt(null);
      setStoppedAt(null);
      setFailure({ titleKey: 'video.recordFailed', error });
    }
  };

  const retry = () => {
    setFailure(null);
    setReady(false);
    setCameraKey((key) => key + 1);
  };

  const onMountError = ({ message }: { message: string }) => {
    const error = new Error(message);
    reportError(error);
    setFailure({ titleKey: 'video.cameraFailed', error });
  };

  return {
    cameraKey,
    isReady,
    onCameraReady: () => setReady(true),
    onMountError,
    isRecording: startedAt !== null && stoppedAt === null,
    isSaving: startedAt !== null && stoppedAt !== null,
    elapsedMs: startedAt === null ? 0 : (stoppedAt ?? now) - startedAt,
    trouble,
    failure,
    record,
    stop: () => stopWith('stop'),
    retry,
  };
}
