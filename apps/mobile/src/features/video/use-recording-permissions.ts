import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { reportError } from '@/lib/sentry';

/** What a recording needs from the phone: the picture and the sound. */
export type RecordingPermission = 'camera' | 'microphone';

export interface RecordingPermissions {
  /** Still being read, or the phone's question is on screen: nothing to say yet. */
  isChecking: boolean;
  /** What the phone has not granted, in the order it is asked for. */
  missing: RecordingPermission[];
  /** Whether the phone will still show its question for everything missing. */
  canAsk: boolean;
  /** Show the phone's question again, for what it still asks. */
  ask: () => Promise<void>;
}

/**
 * The camera and the microphone, each the phone's to grant.
 *
 * The first time, the phone is asked at once — she pressed «Записать видео»,
 * so the question comes where she expects it: the camera first, and the
 * microphone only once the camera is allowed. After a refusal nothing is asked
 * on its own: the screen says what is missing and lets her ask again, or, once
 * the phone has stopped asking, sends her to its settings. Coming back from
 * them, the answer is read again.
 */
export function useRecordingPermissions(): RecordingPermissions {
  const [camera, requestCamera, getCamera] = useCameraPermissions();
  const [microphone, requestMicrophone, getMicrophone] = useMicrophonePermissions();
  const hasAskedOnArrival = useRef(false);

  const ask = useCallback(async () => {
    const cameraAnswer = await requestCamera();
    if (cameraAnswer.granted) {
      await requestMicrophone();
    }
  }, [requestCamera, requestMicrophone]);

  const isRead = camera !== null && microphone !== null;
  const isCameraUnasked = camera?.status === 'undetermined';
  const isMicrophoneUnasked = camera?.granted === true && microphone?.status === 'undetermined';

  useEffect(() => {
    if (!isRead || hasAskedOnArrival.current || !(isCameraUnasked || isMicrophoneUnasked)) {
      return;
    }
    hasAskedOnArrival.current = true;
    ask().catch(reportError);
  }, [isRead, isCameraUnasked, isMicrophoneUnasked, ask]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        getCamera().catch(reportError);
        getMicrophone().catch(reportError);
      }
    });
    return () => subscription.remove();
  }, [getCamera, getMicrophone]);

  if (camera === null || microphone === null) {
    return { isChecking: true, missing: [], canAsk: false, ask };
  }

  // A microphone never asked about, behind a refused camera, is not refused:
  // it is asked for once the camera is allowed.
  const refused = [
    { name: 'camera' as const, answer: camera },
    { name: 'microphone' as const, answer: microphone },
  ].filter(({ answer }) => !answer.granted && answer.status !== 'undetermined');

  return {
    isChecking: isCameraUnasked || isMicrophoneUnasked,
    missing: refused.map(({ name }) => name),
    canAsk: refused.every(({ answer }) => answer.canAskAgain),
    ask,
  };
}
