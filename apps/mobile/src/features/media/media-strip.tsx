import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Text } from '@/components/text';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { mediaFileUri } from './media-path';
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
  /** Absent unless the company allows it — `hosts.gallery_allowed`. */
  onPickFromGallery?: () => void;
  onRemove?: (mediaId: string) => void;
  onRetry?: (mediaId: string) => void;
  isCapturing?: boolean;
  disabled?: boolean;
  /**
   * Whether «Удалить» asks first (owner, 2026-10-10): yes for a photo that is
   * or will be on the server; no for the chat's draft, which never left the phone.
   */
  isRemovalAsked?: boolean;
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
  onPickFromGallery,
  onRemove,
  onRetry,
  isCapturing = false,
  disabled = false,
  isRemovalAsked = true,
}: MediaStripProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  // The photo a removal is asked about; kept while the question fades out.
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isAsking, setAsking] = useState(false);
  const askRemove =
    onRemove === undefined || !isRemovalAsked
      ? onRemove
      : (mediaId: string) => {
          setRemovingId(mediaId);
          setAsking(true);
        };
  const removingNumber = items.findIndex((item) => item.id === removingId) + 1;
  const canCapture =
    onCapture !== undefined && !disabled && !isCapturing && items.length < maxCount;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {items.map((item, index) => (
        <StripTile
          key={item.id}
          item={item}
          number={index + 1}
          onRemove={disabled ? undefined : askRemove}
          onRetry={disabled || item.status !== 'failed' ? undefined : onRetry}
          styles={styles}
        />
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
          <Text tone="primary" weight={600} align="center">
            {t('media.takePhoto')}
          </Text>
          <Text variant="caption" tone="secondary">
            {t('media.count', { taken: items.length, max: maxCount })}
          </Text>
        </Pressable>
      ) : null}

      {/* Only where the company has allowed it, and always after the camera. */}
      {onPickFromGallery !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('steps.pickPhoto')}
          accessibilityState={{ disabled: !canCapture }}
          disabled={!canCapture}
          onPress={onPickFromGallery}
          style={[styles.capture, styles.pick, !canCapture && styles.captureDisabled]}
        >
          <Text tone="primary" weight={600} align="center">
            {t('steps.pickPhoto')}
          </Text>
        </Pressable>
      ) : null}

      <ConfirmDialog
        isVisible={isAsking}
        title={t('steps.removePhotoQuestion')}
        message={removingNumber > 0 ? t('steps.photoName', { index: removingNumber }) : undefined}
        confirmLabel={t('media.remove')}
        variant="destructive"
        onConfirm={() => {
          setAsking(false);
          if (removingId !== null) {
            onRemove?.(removingId);
          }
        }}
        onCancel={() => setAsking(false)}
      />
    </ScrollView>
  );
}

interface StripTileProps {
  item: StripItem;
  /** Counted from one, as she counts them and as the reader says them. */
  number: number;
  onRemove?: (mediaId: string) => void;
  onRetry?: (mediaId: string) => void;
  styles: ReturnType<typeof createStyles>;
}

/**
 * One photo and what can be done to it. The photo is one element for the
 * reader — its number and its state — and each action a button of its own
 * beside it: inside an element read as one, a button cannot be reached.
 */
function StripTile({ item, number, onRemove, onRetry, styles }: StripTileProps) {
  const { t } = useTranslation();
  const status = t(`media.status.${item.status}`);

  return (
    <View style={styles.tile}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('media.photoAccessibility', { index: number, status })}
        style={styles.photo}
      >
        {item.uri !== null ? (
          <Image
            source={{ uri: mediaFileUri(item.uri) }}
            contentFit="cover"
            style={styles.picture}
          />
        ) : (
          <View style={[styles.picture, styles.placeholder]} />
        )}
        {item.status !== 'uploaded' ? (
          <Text variant="caption" tone={item.status === 'failed' ? 'danger' : 'secondary'}>
            {status}
          </Text>
        ) : null}
      </View>
      {onRetry !== undefined ? (
        <TileAction
          label={t('media.retry')}
          accessibilityLabel={t('media.retryPhoto', { index: number })}
          onPress={() => onRetry(item.id)}
          styles={styles}
        />
      ) : null}
      {onRemove !== undefined ? (
        <TileAction
          label={t('media.remove')}
          accessibilityLabel={t('media.removePhoto', { index: number })}
          onPress={() => onRemove(item.id)}
          styles={styles}
        />
      ) : null}
    </View>
  );
}

interface TileActionProps {
  /** The short word under the photo. */
  label: string;
  /** The word and the photo's number: which of five photos it removes. */
  accessibilityLabel: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}

/** An action under a photo: the tile's width and a gloved finger's height. */
function TileAction({ label, accessibilityLabel, onPress, styles }: TileActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      <Text variant="caption" tone="primary">
        {label}
      </Text>
    </Pressable>
  );
}

const TILE_SIZE = 112;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: { gap: Spacing.sm },
    tile: { width: TILE_SIZE },
    photo: { gap: Spacing.xs },
    picture: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: Radius.md },
    placeholder: { backgroundColor: theme.divider },
    action: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    actionPressed: { opacity: 0.6 },
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
    // Dashed, so the two tiles at the end of the strip do not read as the
    // same button twice: the camera is the ordinary way in.
    pick: { borderStyle: 'dashed' },
  });
