import { Stack, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { useScreenEdgePadding } from '@/components/bottom-inset';
import { Button } from '@/components/button';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { keepRecording, type CapturedMedia, type Recording } from '@/features/media/capture';
import { discardFile } from '@/features/media/file';
import type { VideoLimits } from '@/features/media/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { noteStep, reportError } from '@/lib/sentry';

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
  /** Where the preview plays from once «Отправить» moved the file under a name of ours. */
  const [keptUri, setKeptUri] = useState<string | null>(null);
  /** The file is gone: moved, then found empty. Nothing to play, nothing to send. */
  const [isFileLost, setFileLost] = useState(false);
  /** Settled by the commit after a press of «Отправить»: the preview's player is gone then. */
  const committed = useRef<(() => void) | null>(null);
  const unsent = useRef<Unsent | null>(null);
  const isSendingNow = useRef(false);
  const isMounted = useRef(true);
  const hasLeft = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // A send waiting for its commit goes on without one: the screen is gone.
      committed.current?.();
      committed.current = null;
      if (!isSendingNow.current) {
        forget(unsent);
      }
    };
  }, []);

  // After every commit: a send waiting for the preview's player to be gone
  // goes on. Effects of a commit run after the clean-ups of what it unmounted,
  // the player's release among them (review of d0a2738..ec46320).
  useEffect(() => {
    committed.current?.();
    committed.current = null;
  });

  // Handed over: back to the step, once the guard below has stood down.
  useEffect(() => {
    if (isSent && !hasLeft.current) {
      hasLeft.current = true;
      noteStep('video.send', 'leaving');
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
          setKeptUri(null);
          setSendError(null);
          setPhase({ kind: 'preview', recording, end });
        }}
      />,
    );
  }

  const retake = () => {
    forget(unsent);
    setKeptUri(null);
    setFileLost(false);
    setSendError(null);
    setPhase({ kind: 'camera' });
  };

  const send = async () => {
    // The preview's player is let go in the commit this press causes; the
    // file is not moved from under it before that commit is in.
    const isPlayerGone = new Promise<void>((resolve) => {
      committed.current = resolve;
    });
    isSendingNow.current = true;
    setSending(true);
    setSendError(null);
    noteStep('video.send', 'pressed');
    try {
      await isPlayerGone;
      const captured = unsent.current?.kept ?? (await keepRecording(phase.recording));
      unsent.current = { uri: captured.uri, kept: captured };
      if (isMounted.current) {
        setKeptUri(captured.uri);
      }
      noteStep('video.send', 'kept', {
        mediaId: captured.id,
        byteSize: captured.byteSize,
        durationSec: captured.durationSec,
      });
      await onSend(captured);
      // The queue's now: kept on the phone until the server has it.
      unsent.current = null;
      if (isMounted.current) {
        setSent(true);
      }
    } catch (error: unknown) {
      const type = error instanceof Error ? error.name : typeof error;
      noteStep('video.send', 'failed', { type });
      // A caught failure is an event of its own: the marks above go with it.
      reportError(error);
      if (isMounted.current) {
        // Moved and found empty: there is no file left to play or to send.
        setFileLost(type === 'EmptyCaptureError');
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

  // Handed over: the screen goes by itself, and says so meanwhile — never an
  // empty screen with no way out, should the way back not come.
  if (isSent) {
    return titled(<SentNotice onBack={onDone} />);
  }

  const previewUri = isFileLost ? null : (keptUri ?? phase.recording.uri);

  return titled(
    <VideoPreview
      recording={phase.recording}
      uri={previewUri}
      end={phase.end}
      isSending={isSending}
      sendError={sendError}
      onRetake={retake}
      onSend={() => void send()}
    />,
  );
}

/** How long the screen may take to leave by itself before it offers the way back. */
const BACK_FALLBACK_MS = 1_500;

/**
 * The recording is the queue's: what happens to it now, and — only if the
 * screen is still here a moment later — the way back. Offered at once, a tap
 * during the way out would go back a second time, past the step.
 *
 * Centred, and scrolling when taller than the screen — at the largest font on
 * a small phone — rather than cut at either end; the button stops clear of
 * the system's bar (components/bottom-inset.ts).
 */
function SentNotice({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const end = useScreenEdgePadding(Spacing.xl);
  const [isStillHere, setStillHere] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStillHere(true), BACK_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ScrollView style={styles.sent} contentContainerStyle={[layout.sentContent, end]}>
      <Text align="center" accessibilityRole="alert">
        {t('video.queued')}
      </Text>
      {isStillHere ? <Button label={t('video.backToStep')} onPress={onBack} /> : null}
    </ScrollView>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  sentContent: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    sent: { flex: 1, backgroundColor: theme.background },
  });

/** Delete the recording not handed over, wherever its file is now. */
function forget(unsent: { current: Unsent | null }): void {
  if (unsent.current !== null) {
    discardFile(unsent.current.uri);
  }
  unsent.current = null;
}
