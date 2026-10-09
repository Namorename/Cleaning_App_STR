import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
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
};

interface VideoPreviewProps {
  recording: Recording;
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
 */
export function VideoPreview({
  recording,
  end,
  isSending,
  sendError,
  onRetake,
  onSend,
}: VideoPreviewProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const player = useVideoPlayer(recording.uri, (created) => {
    created.loop = false;
  });
  const notice = END_NOTICE[end];

  return (
    <View style={styles.screen}>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        style={layout.video}
        accessibilityLabel={t('video.player')}
      />
      <ScrollView style={layout.panel} contentContainerStyle={layout.controls}>
        {notice !== null ? (
          <Text accessibilityRole="alert" align="center">
            {t(notice)}
          </Text>
        ) : null}
        <Text tone="secondary" align="center">
          {t('steps.videoLength', { seconds: recording.durationSec })}
        </Text>
        {sendError !== null ? <FailureText error={sendError} /> : null}
        <Button label={t('video.send')} isBusy={isSending} onPress={onSend} />
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
  });
