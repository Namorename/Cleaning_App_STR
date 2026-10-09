import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

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

        return (
          <View key={tile.id} style={[layout.tile, size]}>
            <View
              accessible
              accessibilityLabel={t('media.photoAccessibility', { index: index + 1, status })}
            >
              {tile.uri !== null ? (
                <Image
                  source={{ uri: tile.uri }}
                  contentFit="cover"
                  style={[styles.picture, size]}
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
            </View>
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
