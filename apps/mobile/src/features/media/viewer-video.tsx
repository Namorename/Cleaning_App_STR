import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { Colors, Spacing } from '@/constants/theme';

import { reportMediaNotShown } from './display-failure';
import { mediaFileUri } from './media-path';
import type { ViewerItem } from './viewer-items';

interface ViewerVideoProps {
  item: ViewerItem;
}

/**
 * A step's video in the viewer: the phone's own player with its own controls,
 * as in the preview before sending (video-preview.tsx) — it waits for her to
 * press play and keeps the sound. expo-video is in the native build since
 * 1.2.0. No zoom and no swipe over it: its controls take the finger, and a
 * step collects one video.
 */
export function ViewerVideo({ item }: ViewerVideoProps) {
  const { t } = useTranslation();
  const uri = mediaFileUri(item.uri);
  const [hasFailed, setFailed] = useState(false);
  const player = useVideoPlayer(uri, (created) => {
    created.loop = false;
  });

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status !== 'error') {
        return;
      }
      setFailed(true);
      reportMediaNotShown({
        mediaId: item.id,
        kind: 'video',
        surface: 'viewer',
        uri,
        message: error?.message,
      });
    });
    return () => subscription.remove();
  }, [player, item.id, uri]);

  if (hasFailed) {
    return (
      <View style={layout.page}>
        <Text align="center" color={Colors.dark.text} style={layout.failed}>
          {t('media.viewer.videoFailed')}
        </Text>
      </View>
    );
  }

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={layout.page}
      accessibilityLabel={t('video.player')}
    />
  );
}

/** Sizes only; the viewer is dark in either theme. */
const layout = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  failed: { padding: Spacing.xl },
});
