import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import type { MediaItemView } from './schema';

/** A tile of the strip: a server-tracked file, or a capture not yet handed over. */
export interface StripItem {
  id: string;
  uri: string | null;
  status: MediaItemView['status'] | 'local';
}

interface MediaStripProps {
  items: readonly StripItem[];
  maxCount: number;
  /** Absent: the strip is read-only, as on a closed report. */
  onCapture?: () => void;
  onRemove?: (mediaId: string) => void;
  onRetry?: (mediaId: string) => void;
  isCapturing?: boolean;
  disabled?: boolean;
}

/**
 * Photos of a report, side by side, with the camera at the end.
 *
 * Lighter than the step's media block: no minimum, no video, no progress
 * line — a report's photos are optional evidence, not a gate.
 */
export function MediaStrip({
  items,
  maxCount,
  onCapture,
  onRemove,
  onRetry,
  isCapturing = false,
  disabled = false,
}: MediaStripProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const canCapture = onCapture !== undefined && !disabled && !isCapturing && items.length < maxCount;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map((item, index) => (
        <View
          key={item.id}
          style={styles.tile}
          accessible
          accessibilityLabel={t('media.photoAccessibility', {
            index: index + 1,
            status: t(`media.status.${item.status}`),
          })}
        >
          {item.uri !== null ? (
            <Image source={{ uri: item.uri }} contentFit="cover" style={styles.picture} />
          ) : (
            <View style={[styles.picture, styles.placeholder]} />
          )}
          {item.status !== 'uploaded' ? (
            <Text style={[styles.caption, item.status === 'failed' && styles.captionFailed]}>
              {t(`media.status.${item.status}`)}
            </Text>
          ) : null}
          {item.status === 'failed' && onRetry !== undefined && !disabled ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('media.retry')}
              onPress={() => onRetry(item.id)}
              style={styles.action}
            >
              <Text style={styles.actionText}>{t('media.retry')}</Text>
            </Pressable>
          ) : null}
          {onRemove !== undefined && !disabled ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('media.remove')}
              onPress={() => onRemove(item.id)}
              style={styles.action}
            >
              <Text style={styles.actionText}>{t('media.remove')}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {onCapture !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('media.takePhoto')}
          accessibilityState={{ disabled: !canCapture, busy: isCapturing }}
          disabled={!canCapture}
          onPress={onCapture}
          style={[styles.capture, !canCapture && styles.captureDisabled]}
        >
          <Text style={styles.captureText}>{t('media.takePhoto')}</Text>
          <Text style={styles.captureCount}>
            {t('media.count', { taken: items.length, max: maxCount })}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const TILE_SIZE = 112;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: { gap: Spacing.sm },
    tile: { width: TILE_SIZE, gap: Spacing.xs },
    picture: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: Radius.md },
    placeholder: { backgroundColor: theme.divider },
    caption: { color: theme.textSecondary, fontSize: FontSize.caption },
    captionFailed: { color: theme.danger },
    action: { minHeight: MIN_TOUCH_TARGET / 2, justifyContent: 'center' },
    actionText: { color: theme.primary, fontSize: FontSize.caption, fontWeight: '600' },
    capture: {
      width: TILE_SIZE,
      height: TILE_SIZE,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.card,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      padding: Spacing.sm,
    },
    captureDisabled: { opacity: 0.5 },
    captureText: { color: theme.primary, fontSize: FontSize.body, fontWeight: '600', textAlign: 'center' },
    captureCount: { color: theme.textSecondary, fontSize: FontSize.caption },
  });
