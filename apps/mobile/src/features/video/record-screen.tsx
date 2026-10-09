import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LoadingState } from '@/components/loading-state';
import type { Recording } from '@/features/media/capture';
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
  /** Keep the recording and hand it to the upload queue; throws when it could not. */
  onSend: (recording: Recording) => Promise<void>;
}

type Phase = { kind: 'camera' } | { kind: 'preview'; recording: Recording; end: RecordingEnd };

/**
 * A video step's recording, from the phone's permission to the queue.
 *
 * Nothing is drawn over the camera until the phone has granted both it and
 * the microphone; what it refuses is said on a screen of its own. A finished
 * recording is watched before it is sent. The camera's file lives in the
 * cache until «Отправить» keeps it: «Переснять» deletes it, and so does
 * leaving the screen without sending.
 */
export function RecordScreen({ limits, onSend }: RecordScreenProps) {
  const { t } = useTranslation();
  const permissions = useRecordingPermissions();
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [isSending, setSending] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  /** The camera's file not yet handed over: deleted when she leaves without it. */
  const unsent = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (unsent.current !== null) {
        discardFile(unsent.current);
      }
    },
    [],
  );

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

  if (phase.kind === 'camera') {
    return (
      <VideoRecorder
        limits={limits}
        onRecorded={(recording, end) => {
          unsent.current = recording.uri;
          setSendError(null);
          setPhase({ kind: 'preview', recording, end });
        }}
      />
    );
  }

  const retake = () => {
    discardFile(phase.recording.uri);
    unsent.current = null;
    setPhase({ kind: 'camera' });
  };

  const send = async () => {
    setSending(true);
    setSendError(null);
    try {
      await onSend(phase.recording);
      // Kept under a name of ours now: the cache's copy is gone.
      unsent.current = null;
    } catch (error: unknown) {
      setSendError(error);
    } finally {
      setSending(false);
    }
  };

  return (
    <VideoPreview
      recording={phase.recording}
      end={phase.end}
      isSending={isSending}
      sendError={sendError}
      onRetake={retake}
      onSend={() => void send()}
    />
  );
}
