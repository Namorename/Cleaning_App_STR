import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import type { MediaItemView, MediaKind, PhotoLimits } from '@/features/media/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';

interface StepMediaProps {
  kind: MediaKind;
  items: readonly MediaItemView[];
  limits: PhotoLimits;
  maxVideoSec: number;
  /** Pressing capture is refused while the camera is already open. */
  isCapturing: boolean;
  disabled: boolean;
  /** Only when the company allows it — `hosts.gallery_allowed`. */
  canPickFromGallery: boolean;
  onCapture: () => void;
  onPickFromGallery: () => void;
  onRemove: (mediaId: string) => void;
  onRetry: (mediaId: string) => void;
}

/**
 * The photos (or the video) of a step, and the button that takes the next.
 *
 * Each tile says where it stands — a picture speaks for a file that arrived,
 * a spinner for one on its way, and a stranded one offers a retry — because
 * the step cannot be completed until every file is in, and a cleaner has to
 * see which one is holding her. The count under the button says how many
 * more the step wants.
 */
export function StepMedia({
  kind,
  items,
  limits,
  maxVideoSec,
  isCapturing,
  disabled,
  canPickFromGallery,
  onCapture,
  onPickFromGallery,
  onRemove,
  onRetry,
}: StepMediaProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  const max = kind === 'video' ? 1 : limits.max;
  const canCapture = !disabled && !isCapturing && items.length < max;
  const captureLabel = kind === 'video' ? t('steps.recordVideo') : t('steps.takePhoto');
  const pickLabel = kind === 'video' ? t('steps.pickVideo') : t('steps.pickPhoto');

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        {kind === 'video'
          ? t('steps.videoHint', { seconds: maxVideoSec })
          : t('steps.photosHint', { min: limits.min })}
      </Text>

      {items.length === 0 ? (
        <Text style={styles.empty}>{t('steps.mediaEmpty')}</Text>
      ) : (
        <View style={styles.grid}>
          {items.map((item, index) => (
            <MediaTile
              key={item.id}
              item={item}
              index={index}
              disabled={disabled}
              onRemove={onRemove}
              onRetry={onRetry}
              styles={styles}
            />
          ))}
        </View>
      )}

      {kind === 'photo' ? (
        <Text style={styles.progress}>
          {t('steps.photosProgress', { taken: items.length, max: limits.max })}
        </Text>
      ) : null}

      {!disabled ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={captureLabel}
          accessibilityState={{ disabled: !canCapture, busy: isCapturing }}
          disabled={!canCapture}
          onPress={onCapture}
          style={({ pressed }) => [
            styles.captureButton,
            !canCapture && styles.captureDisabled,
            pressed && styles.capturePressed,
          ]}
        >
          {isCapturing ? (
            <ActivityIndicator color={styles.captureText.color} />
          ) : (
            <Text style={styles.captureText}>{captureLabel}</Text>
          )}
        </Pressable>
      ) : null}

      {/* Second, and second in every sense: the camera is the way this is
          meant to be done, and the gallery appears only where the company
          has decided to allow it. */}
      {!disabled && canPickFromGallery ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pickLabel}
          accessibilityState={{ disabled: !canCapture }}
          disabled={!canCapture}
          onPress={onPickFromGallery}
          style={({ pressed }) => [
            styles.pickButton,
            !canCapture && styles.captureDisabled,
            pressed && styles.capturePressed,
          ]}
        >
          <Text style={styles.pickText}>{pickLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface MediaTileProps {
  item: MediaItemView;
  index: number;
  disabled: boolean;
  onRemove: (mediaId: string) => void;
  onRetry: (mediaId: string) => void;
  styles: ReturnType<typeof createStyles>;
}

function MediaTile({ item, index, disabled, onRemove, onRetry, styles }: MediaTileProps) {
  const { t } = useTranslation();
  const statusText =
    item.status === 'uploaded'
      ? t('steps.mediaUploaded')
      : item.status === 'uploading'
        ? t('steps.mediaUploading')
        : t('steps.mediaFailed');
  const label =
    item.kind === 'video'
      ? t('steps.videoAccessibility', { status: statusText })
      : t('steps.photoAccessibility', { index: index + 1, status: statusText });

  return (
    <View style={styles.tile}>
      <View accessible accessibilityLabel={label}>
        {item.kind === 'photo' && item.uri !== null ? (
          <Image source={{ uri: item.uri }} contentFit="cover" style={styles.picture} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>
              {item.kind === 'video'
                ? t('steps.videoLength', { seconds: item.durationSec ?? 0 })
                : t('steps.types.photos_before')}
            </Text>
          </View>
        )}

        <View style={styles.tileFooter}>
          {item.status === 'uploading' ? (
            <ActivityIndicator size="small" color={styles.tileStatus.color} />
          ) : null}
          <Text style={[styles.tileStatus, item.status === 'failed' && styles.tileStatusFailed]}>
            {statusText}
          </Text>
        </View>
      </View>

      {!disabled ? (
        <View style={styles.tileActions}>
          {item.status === 'failed' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('steps.retryUpload')}
              onPress={() => onRetry(item.id)}
              style={({ pressed }) => [styles.tileButton, pressed && styles.capturePressed]}
            >
              <Text style={styles.tileButtonText}>{t('steps.retryUpload')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('steps.removeMedia')}
            onPress={() => onRemove(item.id)}
            style={({ pressed }) => [styles.tileButton, pressed && styles.capturePressed]}
          >
            <Text style={styles.tileButtonText}>{t('steps.removeMedia')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const TILE_SIZE = 150;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: { gap: Spacing.md },
    hint: { color: theme.textSecondary, fontSize: FontSize.body },
    empty: { color: theme.textSecondary, fontSize: FontSize.body, fontStyle: 'italic' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
    tile: {
      width: TILE_SIZE,
      backgroundColor: theme.card,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      overflow: 'hidden',
    },
    picture: { width: TILE_SIZE, height: TILE_SIZE },
    placeholder: {
      width: TILE_SIZE,
      height: TILE_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.divider,
    },
    placeholderText: { color: theme.text, fontSize: FontSize.body, fontWeight: '600' },
    tileFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    tileStatus: { color: theme.textSecondary, fontSize: FontSize.caption },
    tileStatusFailed: { color: theme.danger, fontWeight: '600' },
    tileActions: { flexDirection: 'row', flexWrap: 'wrap' },
    tileButton: {
      minHeight: MIN_TOUCH_TARGET,
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.sm,
    },
    tileButtonText: { color: theme.primary, fontSize: FontSize.body, fontWeight: '600' },
    progress: { color: theme.text, fontSize: FontSize.body, fontWeight: '600' },
    captureButton: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    captureDisabled: { opacity: 0.5 },
    capturePressed: { opacity: 0.75 },
    captureText: { color: theme.onPrimary, fontSize: FontSize.title, fontWeight: '600' },
    // Outlined rather than filled: the camera is the primary way, the
    // gallery the exception a company has opted into.
    pickButton: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickText: { color: theme.primary, fontSize: FontSize.body, fontWeight: '600' },
  });
