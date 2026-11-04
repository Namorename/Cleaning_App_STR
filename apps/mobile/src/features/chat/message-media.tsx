import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { reportMediaNotShown } from '@/features/media/display-failure';
import { mediaFileUri } from '@/features/media/media-path';
import { PhotoViewerHost } from '@/features/media/photo-viewer-host';
import { viewerItemsOf } from '@/features/media/viewer-items';

import type { MessageTile } from './media-tiles';

interface MessageMediaProps {
  tiles: readonly MessageTile[];
  /** Absent on someone else's message: nothing there is hers to change. */
  onRetry?: (mediaId: string) => void;
  onRemove?: (mediaId: string) => void;
}

/**
 * The photos inside a bubble.
 *
 * A picture where there is one; a tile with a word where there is not yet.
 * Only a failed upload offers a retry — the main move, a 56 dp button — and
 * only a failed or an expired one offers "remove"; an uploaded photo is part
 * of what was said. A tile with buttons under it is as wide as a step's
 * (step-media.tsx), so their words fit; the rest stay small.
 */
export function MessageMedia({ tiles, onRetry, onRemove }: MessageMediaProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  // The photo opened on the whole screen; the viewer turns through the
  // message's others.
  const [openId, setOpenId] = useState<string | null>(null);
  const viewerItems = useMemo(() => viewerItemsOf(tiles), [tiles]);
  const closeViewer = useCallback(() => setOpenId(null), []);

  if (tiles.length === 0) {
    return null;
  }

  return (
    <View style={layout.row}>
      {tiles.map((tile, index) => {
        const status = statusText(tile.status, t);
        const isStranded = tile.status === 'failed' || tile.status === 'expired';
        const canRetry = tile.status === 'failed' && onRetry !== undefined;
        const canRemove = isStranded && tile.canRemove && onRemove !== undefined;
        const size = canRetry || canRemove ? layout.wide : layout.small;
        const uri = tile.uri === null ? null : mediaFileUri(tile.uri);
        const body = (
          <>
            {uri !== null ? (
              <Image
                source={{ uri }}
                contentFit="cover"
                style={[styles.picture, size]}
                onError={(event) =>
                  reportMediaNotShown({
                    mediaId: tile.id,
                    kind: 'photo',
                    surface: 'chat',
                    uri,
                    message: event.error,
                  })
                }
              />
            ) : (
              <View style={[styles.picture, styles.placeholder, size]}>
                {tile.status === 'uploading' || tile.status === 'awaited' ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : null}
              </View>
            )}
            {tile.status !== 'uploaded' ? (
              <Text variant="caption" tone={isStranded ? 'danger' : 'secondary'}>
                {status}
              </Text>
            ) : null}
          </>
        );

        return (
          <View key={tile.id} style={[layout.tile, size]}>
            {uri !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('media.openPhoto', { index: index + 1, total: tiles.length })}
                accessibilityValue={{ text: status }}
                onPress={() => setOpenId(tile.id)}
                style={({ pressed }) => pressed && layout.pressed}
              >
                {body}
              </Pressable>
            ) : (
              <View
                accessible
                accessibilityLabel={t('media.photoAccessibility', { index: index + 1, status })}
              >
                {body}
              </View>
            )}
            {/* Her bubble is the tonal `secondary` fill, so neither button can
                be: retry is the main move in the cta fill, remove is framed. */}
            {canRetry ? (
              <Button
                label={t('media.retry')}
                left={<Icon name="action.retry" size="small" tone="onCta" />}
                onPress={() => onRetry(tile.id)}
                style={layout.tileButton}
              />
            ) : null}
            {canRemove ? (
              <Button
                variant="outline"
                label={t('media.remove')}
                left={<Icon name="action.delete" size="small" tone="primary" />}
                onPress={() => onRemove(tile.id)}
                style={layout.tileButton}
              />
            ) : null}
          </View>
        );
      })}

      {openId !== null ? (
        <PhotoViewerHost
          items={viewerItems}
          total={tiles.length}
          openId={openId}
          onClose={closeViewer}
        />
      ) : null}
    </View>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

function statusText(status: MessageTile['status'], t: Translate): string {
  return status === 'awaited' ? t('chat.photoOnItsWay') : t(`media.status.${status}`);
}

/** A photo in a bubble; a photo with buttons under it, as wide as a step's tile. */
const TILE_SIZE = 96;
const WIDE_TILE_SIZE = 150;

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { gap: Spacing.xs },
  small: { width: TILE_SIZE },
  wide: { width: WIDE_TILE_SIZE },
  // Narrower than a screen's button: it shares a tile's width.
  tileButton: { paddingHorizontal: Spacing.sm },
  pressed: { opacity: 0.7 },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    picture: { aspectRatio: 1, borderRadius: Radius.md },
    placeholder: {
      backgroundColor: theme.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
