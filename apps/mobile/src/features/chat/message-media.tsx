import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
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
 * A picture where there is one; a grey tile with a word where there is not
 * yet. Only a failed upload offers a retry, and only a failed or an expired
 * one offers "remove" — an uploaded photo is part of what was said.
 */
export function MessageMedia({ tiles, onRetry, onRemove }: MessageMediaProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  if (tiles.length === 0) {
    return null;
  }

  return (
    <View style={styles.row}>
      {tiles.map((tile, index) => {
        const status = statusText(tile.status, t);
        const canRetry = tile.status === 'failed' && onRetry !== undefined;
        const canRemove =
          (tile.status === 'failed' || tile.status === 'expired') && onRemove !== undefined;

        return (
          <View key={tile.id} style={styles.tile}>
            <View
              accessible
              accessibilityLabel={t('media.photoAccessibility', { index: index + 1, status })}
            >
              {tile.uri !== null ? (
                <Image source={{ uri: tile.uri }} contentFit="cover" style={styles.picture} />
              ) : (
                <View style={[styles.picture, styles.placeholder]}>
                  {tile.status === 'uploading' || tile.status === 'awaited' ? (
                    <ActivityIndicator size="small" color={styles.caption.color} />
                  ) : null}
                </View>
              )}
              {tile.status !== 'uploaded' ? (
                <Text
                  style={[
                    styles.caption,
                    (tile.status === 'failed' || tile.status === 'expired') && styles.captionFailed,
                  ]}
                >
                  {status}
                </Text>
              ) : null}
            </View>
            {canRetry ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('media.retry')}
                onPress={() => onRetry(tile.id)}
                style={styles.action}
              >
                <Text style={styles.actionText}>{t('media.retry')}</Text>
              </Pressable>
            ) : null}
            {canRemove ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('media.remove')}
                onPress={() => onRemove(tile.id)}
                style={styles.action}
              >
                <Text style={styles.actionText}>{t('media.remove')}</Text>
              </Pressable>
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

const TILE_SIZE = 96;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    tile: { width: TILE_SIZE, gap: Spacing.xs },
    picture: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: Radius.md },
    placeholder: {
      backgroundColor: theme.divider,
      alignItems: 'center',
      justifyContent: 'center',
    },
    caption: { color: theme.textSecondary, fontSize: FontSize.caption },
    captionFailed: { color: theme.danger },
    action: { minHeight: MIN_TOUCH_TARGET / 2, justifyContent: 'center' },
    actionText: { color: theme.primary, fontSize: FontSize.caption, fontWeight: '600' },
  });
