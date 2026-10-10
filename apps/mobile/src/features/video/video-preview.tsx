import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useScreenEdgePadding } from '@/components/bottom-inset';
import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import type { Recording } from '@/features/media/capture';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import type { RecordingEnd } from './recording';

/** What the preview says about how the recording ended; her own «Стоп» needs no words. */
const END_NOTICE: Readonly<Record<RecordingEnd, string | null>> = {
  stop: null,
  limit: 'video.limitReached',
  background: 'video.backgroundStopped',
  // Neither her «Стоп» nor a limit: no cause is named that may not be the one.
  interrupted: 'video.interrupted',
};

interface VideoPreviewProps {
  recording: Recording;
  /**
   * Where the file is now: the camera's path, or the name of ours an
   * «Отправить» that went no further moved it to — or null once it is lost.
   */
  uri: string | null;
  end: RecordingEnd;
  isSending: boolean;
  /** Why the last «Отправить» did not go through, or null. */
  sendError: unknown;
  onRetake: () => void;
  onSend: () => void;
}

/**
 * The recording, watched before it is sent (owner's word 2026-10-01).
 *
 * The phone's own player with its own controls; it waits for her to press
 * play and keeps the sound. «Отправить» is the main button; «Переснять»
 * throws this one away and opens the camera again.
 *
 * While «Отправить» hands the recording over, the player is let go: its file
 * is moving to another folder under it, and the screen is about to leave
 * (night of 2026-10-10, block 1 — the empty screen after «Отправить»). A
 * hand-over that fails brings it back, on the file where it now is.
 */
export function VideoPreview({
  recording,
  uri,
  end,
  isSending,
  sendError,
  onRetake,
  onSend,
}: VideoPreviewProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  // «Переснять» clears the system's bar (components/bottom-inset.ts).
  const edge = useScreenEdgePadding(Spacing.lg);
  const notice = END_NOTICE[end];

  return (
    <View style={styles.screen}>
      {isSending ? (
        <LoadingState label={t('video.preparing')} />
      ) : uri === null ? (
        <View style={styles.lost}>
          <Text align="center" accessibilityRole="alert">
            {t('video.recordingLost')}
          </Text>
        </View>
      ) : (
        <PreviewPlayer uri={uri} />
      )}
      <ScrollView style={layout.panel} contentContainerStyle={[layout.controls, edge]}>
        {notice !== null ? (
          <Text accessibilityRole="alert" align="center">
            {t(notice)}
          </Text>
        ) : null}
        <Text tone="secondary" align="center">
          {t('steps.videoLength', { seconds: recording.durationSec })}
        </Text>
        {sendError !== null ? <FailureText error={sendError} /> : null}
        <Button
          label={t('video.send')}
          isBusy={isSending}
          isDisabled={uri === null}
          onPress={onSend}
        />
        <Button
          variant="outline"
          label={t('video.retake')}
          isDisabled={isSending}
          onPress={onRetake}
        />
      </ScrollView>
    </View>
  );
}

/** The phone's own player; let go, with its file, when this unmounts (expo-video). */
function PreviewPlayer({ uri }: { uri: string }) {
  const { t } = useTranslation();
  const player = useVideoPlayer(uri, (created) => {
    created.loop = false;
  });

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={layout.video}
      accessibilityLabel={t('video.player')}
    />
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  video: { flex: 1 },
  // The buttons stay reachable at the largest font: the panel scrolls, the video shrinks.
  panel: { flexGrow: 0 },
  controls: { gap: Spacing.sm, padding: Spacing.lg },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    lost: { flex: 1, justifyContent: 'center', padding: Spacing.xl },
  });
