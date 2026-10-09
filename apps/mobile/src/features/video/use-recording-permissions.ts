import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
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
 * Each is asked once on its own, where she expects it — she pressed «Записать
 * видео»: the camera first, and the microphone only once the camera is
 * allowed. A camera refused at first and allowed later in the phone's
 * settings brings the microphone's question when she comes back: each of the
 * two remembers whether it was asked, not the screen as a whole. After a
 * refusal nothing is asked on its own: the screen says what is missing and
 * lets her ask again, or, once the phone has stopped asking, sends her to its
 * settings. Coming back from them, the answer is read again.
 *
 * The screen waits only while a question is on screen or about to be: a
 * question put away without an answer is said as missing, not waited for.
 */
export function useRecordingPermissions(): RecordingPermissions {
  const [camera, requestCamera, getCamera] = useCameraPermissions();
  const [microphone, requestMicrophone, getMicrophone] = useMicrophonePermissions();
  const [asked, setAsked] = useState<ReadonlySet<RecordingPermission>>(() => new Set());
  const [isAsking, setAsking] = useState(false);
  // The same answer for a second caller before the first one's state is drawn.
  const isQuestionOpen = useRef(false);

  /** One question at a time: the camera's (and then the microphone's), or the microphone's. */
  const question = useCallback(
    async (fromCamera: boolean) => {
      if (isQuestionOpen.current) {
        return;
      }
      isQuestionOpen.current = true;
      setAsking(true);
      try {
        if (fromCamera) {
          setAsked((done) => new Set(done).add('camera'));
          const cameraAnswer = await requestCamera();
          if (!cameraAnswer.granted) {
            return;
          }
        }
        setAsked((done) => new Set(done).add('microphone'));
        await requestMicrophone();
      } finally {
        isQuestionOpen.current = false;
        setAsking(false);
      }
    },
    [requestCamera, requestMicrophone],
  );

  const ask = useCallback(() => question(true), [question]);

  const isRead = camera !== null && microphone !== null;
  const isCameraUnasked = camera?.status === 'undetermined';
  const isMicrophoneUnasked = camera?.granted === true && microphone?.status === 'undetermined';
  const next: RecordingPermission | null =
    !isRead || isAsking
      ? null
      : isCameraUnasked && !asked.has('camera')
        ? 'camera'
        : isMicrophoneUnasked && !asked.has('microphone')
          ? 'microphone'
          : null;

  useEffect(() => {
    if (next !== null) {
      question(next === 'camera').catch(reportError);
    }
  }, [next, question]);

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

  // A microphone never asked about, behind a camera not allowed, is not
  // refused: it is asked for once the camera is allowed.
  const refused = [
    { name: 'camera' as const, answer: camera },
    { name: 'microphone' as const, answer: microphone },
  ].filter(
    ({ name, answer }) =>
      !answer.granted &&
      !(name === 'microphone' && !camera.granted && answer.status === 'undetermined'),
  );

  return {
    isChecking: isAsking || next !== null,
    missing: refused.map(({ name }) => name),
    canAsk: refused.every(({ answer }) => answer.canAskAgain),
    ask,
  };
}
