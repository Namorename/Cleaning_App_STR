import { STATUS_TONE, statusIcon } from '@str-ops/shared';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import type { MediaItemView, MediaKind, PhotoLimits } from '@/features/media/schema';
import { useTheme } from '@/hooks/use-theme';
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
 *
 * The owner kept the layout (decisions §2): the camera stays under the grid.
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

  const max = kind === 'video' ? 1 : limits.max;
  const canCapture = !disabled && !isCapturing && items.length < max;
  const captureLabel = kind === 'video' ? t('steps.recordVideo') : t('steps.takePhoto');
  const pickLabel = kind === 'video' ? t('steps.pickVideo') : t('steps.pickPhoto');

  return (
    <View style={layout.container}>
      <Text tone="secondary">
        {kind === 'video'
          ? t('steps.videoHint', { seconds: maxVideoSec })
          : t('steps.photosHint', { count: limits.min })}
      </Text>

      {items.length === 0 ? (
        <Text tone="secondary">{t('steps.mediaEmpty')}</Text>
      ) : (
        <View style={layout.grid}>
          {items.map((item, index) => (
            <MediaTile
              key={item.id}
              item={item}
              index={index}
              disabled={disabled}
              onRemove={onRemove}
              onRetry={onRetry}
            />
          ))}
        </View>
      )}

      {kind === 'photo' ? (
        <Text>{t('steps.photosProgress', { taken: items.length, max: limits.max })}</Text>
      ) : null}

      {!disabled ? (
        <Button
          label={captureLabel}
          isBusy={isCapturing}
          isDisabled={!canCapture && !isCapturing}
          left={
            <Icon
              testID="capture-icon"
              name="action.takePhoto"
              tone={canCapture ? 'onCta' : 'muted'}
            />
          }
          onPress={onCapture}
        />
      ) : null}

      {/* Second, and second in every sense: the camera is the way this is
          meant to be done, and the gallery appears only where the company
          has decided to allow it. */}
      {!disabled && canPickFromGallery ? (
        <Button
          variant="outline"
          label={pickLabel}
          isDisabled={!canCapture}
          left={<Icon name="action.fromGallery" tone={canCapture ? 'primary' : 'muted'} />}
          onPress={onPickFromGallery}
        />
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
}

function MediaTile({ item, index, disabled, onRemove, onRetry }: MediaTileProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
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
          <Image source={{ uri: item.uri }} contentFit="cover" style={layout.picture} />
        ) : (
          <View style={styles.placeholder}>
            <Text align="center">
              {item.kind === 'video'
                ? t('steps.videoLength', { seconds: item.durationSec ?? 0 })
                : t('steps.photoPlaceholder')}
            </Text>
          </View>
        )}

        <View style={layout.tileFooter}>
          <TileStatus status={item.status} />
          <Text
            variant="caption"
            tone={item.status === 'failed' ? 'danger' : 'secondary'}
            style={layout.shrink}
          >
            {statusText}
          </Text>
        </View>
      </View>

      {!disabled ? (
        <View style={layout.tileActions}>
          {item.status === 'failed' ? (
            <Button
              variant="secondary"
              label={t('steps.retryUpload')}
              left={<Icon name="action.retry" size="small" tone="onSecondary" />}
              onPress={() => onRetry(item.id)}
              style={layout.tileButton}
            />
          ) : null}
          <Button
            variant="destructive"
            label={t('steps.removeMedia')}
            left={<Icon name="action.delete" size="small" tone="danger" />}
            onPress={() => onRemove(item.id)}
            style={layout.tileButton}
          />
        </View>
      ) : null}
    </View>
  );
}

interface TileStatusProps {
  status: MediaItemView['status'];
}

/** Where a file stands, beside its words: a spinner on its way, ✓ in, ⚠ stranded. */
function TileStatus({ status }: TileStatusProps) {
  const theme = useTheme();

  if (status === 'uploading') {
    return <ActivityIndicator size="small" color={theme.textSecondary} />;
  }
  const key = status === 'uploaded' ? 'media.uploaded' : 'media.failed';
  const glyph = statusIcon(key);
  if (glyph === null) {
    return null;
  }
  return (
    <Icon
      testID="media-status-icon"
      name={glyph}
      size="small"
      color={theme.tone[STATUS_TONE[key]].fg}
    />
  );
}

const TILE_SIZE = 150;

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  container: { gap: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  picture: { width: TILE_SIZE, height: TILE_SIZE },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  shrink: { flexShrink: 1 },
  tileActions: { gap: Spacing.xs, padding: Spacing.xs },
  // Narrower than a screen's button: two of them share a tile.
  tileButton: { paddingHorizontal: Spacing.sm },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    tile: {
      width: TILE_SIZE,
      backgroundColor: theme.card,
      borderRadius: Radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      overflow: 'hidden',
    },
    // Grows with its words at a large font, rather than cut them.
    placeholder: {
      minHeight: TILE_SIZE,
      padding: Spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceAlt,
    },
  });
