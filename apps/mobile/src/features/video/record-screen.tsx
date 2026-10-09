import { Stack, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { LoadingState } from '@/components/loading-state';
import { keepRecording, type CapturedMedia, type Recording } from '@/features/media/capture';
import { discardFile } from '@/features/media/file';
import type { VideoLimits } from '@/features/media/schema';
import { reportError } from '@/lib/sentry';

import { PermissionScreen } from './permission-screen';
import type { RecordingEnd } from './recording';
import { useRecordingPermissions } from './use-recording-permissions';
import { VideoPreview } from './video-preview';
import { VideoRecorder } from './video-recorder';

export interface RecordScreenProps {
  limits: VideoLimits;
  /** Remember the kept recording and hand it to the upload queue; throws when it could not. */
  onSend: (captured: CapturedMedia) => Promise<void>;
  /** Leave the screen, once the recording is the queue's. */
  onDone: () => void;
}

type Phase = { kind: 'camera' } | { kind: 'preview'; recording: Recording; end: RecordingEnd };

/** The recording not yet handed over: where its file is, and what was kept of it. */
interface Unsent {
  uri: string;
  /** Kept under a name of ours by an «Отправить» that went no further. */
  kept: CapturedMedia | null;
}

/**
 * A video step's recording, from the phone's permission to the queue.
 *
 * Nothing is drawn over the camera until the phone has granted both it and
 * the microphone; what it refuses is said on a screen of its own. A finished
 * recording is watched before it is sent, under a header that says so.
 *
 * The file lives in the camera's cache until «Отправить» moves it under a
 * name of ours; from then on that kept file is the recording, and an
 * «Отправить» tried again sends it rather than the camera's path it has
 * left. «Переснять» deletes whichever it is, and so does leaving without
 * sending — which asks first, on the back button and on an iPhone's edge
 * swipe alike. A recording on its way to the queue is not deleted by the
 * screen going: the queue keeps it, or, when the send fails with nobody left
 * to try again, the send deletes it.
 */
export function RecordScreen({ limits, onSend, onDone }: RecordScreenProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const permissions = useRecordingPermissions();
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [isSending, setSending] = useState(false);
  const [isSent, setSent] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  const unsent = useRef<Unsent | null>(null);
  const isSendingNow = useRef(false);
  const isMounted = useRef(true);
  const hasLeft = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (!isSendingNow.current) {
        forget(unsent);
      }
    };
  }, []);

  // Handed over: back to the step, once the guard below has stood down.
  useEffect(() => {
    if (isSent && !hasLeft.current) {
      hasLeft.current = true;
      onDone();
    }
  }, [isSent, onDone]);

  usePreventRemove(phase.kind === 'preview' && !isSent, ({ data }) => {
    // A moment: the recording is on its way to the queue.
    if (isSendingNow.current) {
      return;
    }
    Alert.alert(
      t('video.leaveTitle'),
      t('video.leaveBody'),
      [
        { text: t('video.stay'), style: 'cancel' },
        {
          text: t('video.discard'),
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
      ],
      { cancelable: true },
    );
  });

  const titled = (body: ReactNode) => (
    <>
      <Stack.Screen
        options={{
          title: t(phase.kind === 'preview' ? 'video.previewTitle' : 'video.recordTitle'),
        }}
      />
      {body}
    </>
  );

  if (permissions.isChecking) {
    return titled(<LoadingState label={t('video.starting')} />);
  }

  if (permissions.missing.length > 0) {
    return titled(
      <PermissionScreen
        missing={permissions.missing}
        canAsk={permissions.canAsk}
        onAsk={() => {
          permissions.ask().catch(reportError);
        }}
      />,
    );
  }

  if (phase.kind === 'camera') {
    return titled(
      <VideoRecorder
        limits={limits}
        onRecorded={(recording, end) => {
          unsent.current = { uri: recording.uri, kept: null };
          setSendError(null);
          setPhase({ kind: 'preview', recording, end });
        }}
      />,
    );
  }

  const retake = () => {
    forget(unsent);
    setSendError(null);
    setPhase({ kind: 'camera' });
  };

  const send = async () => {
    isSendingNow.current = true;
    setSending(true);
    setSendError(null);
    try {
      const captured = unsent.current?.kept ?? (await keepRecording(phase.recording));
      unsent.current = { uri: captured.uri, kept: captured };
      await onSend(captured);
      // The queue's now: kept on the phone until the server has it.
      unsent.current = null;
      if (isMounted.current) {
        setSent(true);
      }
    } catch (error: unknown) {
      if (isMounted.current) {
        setSendError(error);
      } else {
        // Nobody is left to try again.
        forget(unsent);
      }
    } finally {
      isSendingNow.current = false;
      if (isMounted.current) {
        setSending(false);
      }
    }
  };

  return titled(
    <VideoPreview
      recording={phase.recording}
      end={phase.end}
      isSending={isSending || isSent}
      sendError={sendError}
      onRetake={retake}
      onSend={() => void send()}
    />,
  );
}

/** Delete the recording not handed over, wherever its file is now. */
function forget(unsent: { current: Unsent | null }): void {
  if (unsent.current !== null) {
    discardFile(unsent.current.uri);
  }
  unsent.current = null;
}
