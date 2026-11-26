import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { PhotoViewerHost } from '@/features/media/photo-viewer-host';
import { useMediaUrls } from '@/features/media/use-media';
import { viewerItemsOf, type ViewerTile } from '@/features/media/viewer-items';
import { clockText } from '@/features/video/recording';
import { useThemedStyles } from '@/hooks/use-themed-styles';

/** A stored file a tile shows: what it is and where it lies. */
export interface TileFile {
  id: string;
  kind: 'photo' | 'video';
  storage_path: string;
  duration_sec: number | null;
}

interface MediaTilesProps {
  files: readonly TileFile[];
}

/**
 * Read-only tiles of stored files: a photo as its picture, a video as a word and its length; any
 * of them opens the viewer over the screen. The office's batches and the technician's steps on a
 * task's screen show their files this way.
 */
export function MediaTiles({ files }: MediaTilesProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const paths = useMemo(() => files.map((file) => file.storage_path), [files]);
  const urls = useMediaUrls(paths);
  const tiles = useMemo<(ViewerTile & { file: TileFile })[]>(
    () =>
      files.map((file) => ({
        id: file.id,
        kind: file.kind,
        uri: urls.data?.[file.storage_path] ?? null,
        file,
      })),
    [files, urls.data],
  );
  const viewerItems = useMemo(() => viewerItemsOf(tiles), [tiles]);
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);

  if (files.length === 0) {
    return null;
  }

  return (
    <>
      <View style={layout.tiles}>
        {tiles.map((tile, index) => {
          const word =
            tile.file.kind === 'video'
              ? t('problems.additions.fileVideo')
              : t('problems.additions.filePhoto');
          return (
            <Pressable
              key={tile.id}
              accessibilityRole="button"
              accessibilityLabel={
                tile.file.kind === 'video'
                  ? t('media.openVideo')
                  : t('media.openPhoto', { index: index + 1, total: tiles.length })
              }
              disabled={tile.uri === null}
              onPress={() => setOpenId(tile.id)}
              style={styles.tile}
            >
              {tile.file.kind === 'photo' && tile.uri !== null ? (
                <Image source={{ uri: tile.uri }} contentFit="cover" style={styles.picture} />
              ) : (
                <View style={[styles.picture, styles.video]}>
                  <Text weight={700} tone="secondary">
                    {word}
                  </Text>
                  {tile.file.duration_sec === null ? null : (
                    <Text variant="caption" tone="secondary">
                      {clockText(Math.round(tile.file.duration_sec))}
                    </Text>
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      {openId !== null ? (
        <PhotoViewerHost items={viewerItems} total={tiles.length} openId={openId} onClose={close} />
      ) : null}
    </>
  );
}

const TILE = 88;

const layout = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    tile: {
      width: TILE,
      height: TILE,
      borderRadius: Radius.md,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    picture: { width: '100%', height: '100%' },
    video: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: theme.surfaceAlt,
    },
  });
