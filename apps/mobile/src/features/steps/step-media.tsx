import { STATUS_TONE, statusIcon } from '@str-ops/shared';
import { Image } from 'expo-image';
import type { TFunction } from 'i18next';
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
  /**
   * The longest video the step accepts (`videoLimits`), or null while the
   * company's settings are unknown — and then recording waits.
   */
  maxVideoSec: number | null;
  /** Pressing capture is refused while the camera is already open. */
  isCapturing: boolean;
  disabled: boolean;
  /**
   * Only when the company allows it — `hosts.gallery_allowed` — and for photos
   * alone: a video is shot with the app's camera (`videoCameraOnly`).
   */
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
  const isWaitingForSettings = kind === 'video' && maxVideoSec === null;
  const canCapture = !disabled && !isCapturing && !isWaitingForSettings && items.length < max;
  const captureLabel = kind === 'video' ? t('steps.recordVideo') : t('steps.takePhoto');
  const canShowGallery = canPickFromGallery && kind === 'photo';

  return (
    <View style={layout.container}>
      <Text tone="secondary">
        {kind === 'photo'
          ? t('steps.photosHint', { count: limits.min })
          : maxVideoSec === null
            ? t('steps.videoSettingsUnknown')
            : t('steps.videoHint', { seconds: maxVideoSec })}
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
          has decided to allow it — for photos; a video never comes from it. */}
      {!disabled && canShowGallery ? (
        <Button
          variant="outline"
          label={t('steps.pickPhoto')}
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

/** How much of a file on its way has gone, in whole percent; null when unknown or not moving. */
function sentPercent(item: MediaItemView): number | null {
  if (item.status !== 'uploading' || item.isWaitingForNetwork === true) {
    return null;
  }
  return item.progress === undefined ? null : Math.floor(item.progress * 100);
}

function statusTextOf(item: MediaItemView, percent: number | null, t: TFunction): string {
  if (item.status === 'uploaded') {
    return t('steps.mediaUploaded');
  }
  if (item.status === 'failed') {
    return t('steps.mediaFailed');
  }
  if (item.isWaitingForNetwork === true) {
    return t('steps.mediaWaitingForNetwork');
  }
  return percent === null
    ? t('steps.mediaUploading')
    : t('steps.mediaUploadingPercent', { percent });
}

function MediaTile({ item, index, disabled, onRemove, onRetry }: MediaTileProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  // A video goes up in pieces and says how far it has got: in words to the
  // eye, and as a bar under them — to the reader a progress bar with its
  // value, so the tile's own words do not say the number a second time.
  const percent = sentPercent(item);
  const statusText = statusTextOf(item, percent, t);
  const spokenStatus = statusTextOf(item, null, t);
  const label =
    item.kind === 'video'
      ? t('steps.videoAccessibility', { status: spokenStatus })
      : t('steps.photoAccessibility', { index: index + 1, status: spokenStatus });
  // The tile's buttons say which file they act on: «Удалить. Фото 2».
  const tileName =
    item.kind === 'video' ? t('steps.videoName') : t('steps.photoName', { index: index + 1 });
  const retryLabel = t('steps.retryUpload');
  const removeLabel = t('steps.removeMedia');
  // A video's upload runs on in the queue whatever the screen says; removed
  // under it, the row would go and the upload fail. It can go once it is in.
  const canRemove = !(item.kind === 'video' && item.status === 'uploading');

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
          <TileStatus status={item.status} isWaiting={item.isWaitingForNetwork === true} />
          <Text
            variant="caption"
            tone={item.status === 'failed' ? 'danger' : 'secondary'}
            style={layout.shrink}
          >
            {statusText}
          </Text>
        </View>
      </View>

      {/* Outside the tile's words, so the reader can reach it as a bar of its own. */}
      {percent !== null ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={tileName}
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          style={styles.progressTrack}
        >
          <View
            testID="media-progress-fill"
            style={[styles.progressFill, { width: `${percent}%` }]}
          />
        </View>
      ) : null}

      {/* Words only, no icon beside them: two buttons share a 150 dp tile,
          and from a font scale of 1.2 an icon took the room of the label. */}
      {!disabled ? (
        <View style={layout.tileActions}>
          {item.status === 'failed' ? (
            <Button
              variant="secondary"
              label={retryLabel}
              accessibilityLabel={`${retryLabel}. ${tileName}`}
              onPress={() => onRetry(item.id)}
              style={layout.tileButton}
            />
          ) : null}
          {canRemove ? (
            <Button
              variant="destructive"
              label={removeLabel}
              accessibilityLabel={`${removeLabel}. ${tileName}`}
              onPress={() => onRemove(item.id)}
              style={layout.tileButton}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

interface TileStatusProps {
  status: MediaItemView['status'];
  /** On its way, but held by the queue until there is signal. */
  isWaiting: boolean;
}

/**
 * Where a file stands, beside its words: a spinner on its way, ‖ waiting for
 * signal, ✓ in, ⚠ stranded.
 */
function TileStatus({ status, isWaiting }: TileStatusProps) {
  const theme = useTheme();

  if (status === 'uploading' && isWaiting) {
    return <Icon testID="media-status-icon" name="status.paused" size="small" tone="secondary" />;
  }
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
/** The upload bar under a video's length. */
const PROGRESS_HEIGHT = 4;

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
    // A line under the tile's words, not text: its height is its look.
    progressTrack: {
      height: PROGRESS_HEIGHT,
      backgroundColor: theme.divider,
    },
    progressFill: {
      height: PROGRESS_HEIGHT,
      backgroundColor: theme.tone[STATUS_TONE['media.uploading']].mark,
    },
  });
