import { ADDITION_MAX_FILES } from '@str-ops/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { capturePhoto, pickPhotoFromGallery } from '@/features/media/capture';
import { attachFailure } from '@/features/media/failure';
import { mediaFileUri } from '@/features/media/media-path';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { addPick, hasRoom, removePick, useOfficeFlow, type OfficePick } from './office-picks';

interface OfficeFilesEditorProps {
  problemId: string;
  /** Nothing may change: the files are on their way, or added. */
  isLocked: boolean;
}

/**
 * The files the office picks for a task (20261126100000): a photo from the camera or the
 * gallery, a video recorded or chosen (the step's recording screen, `problem/[id]/record`), each
 * a tile with where it is on its way and, when it failed, why — kept until it is tried again or
 * taken out.
 */
export function OfficeFilesEditor({ problemId, isLocked }: OfficeFilesEditorProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const flow = useOfficeFlow(problemId);
  const [isCapturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canAdd = !isLocked && !isCapturing && hasRoom(flow);

  const takePhoto = async (source: 'camera' | 'gallery') => {
    if (!canAdd) {
      return;
    }
    setCapturing(true);
    setNotice(null);
    try {
      const captured = source === 'gallery' ? await pickPhotoFromGallery() : await capturePhoto();
      if (captured !== null && !addPick(problemId, captured)) {
        setNotice(t('problems.additions.tooMany', { count: ADDITION_MAX_FILES }));
      }
    } catch (error: unknown) {
      setNotice(attachFailure(error, t));
    } finally {
      setCapturing(false);
    }
  };

  const takeVideo = (from: 'camera' | 'gallery') => {
    if (canAdd) {
      router.push({ pathname: '/problem/[id]/record', params: { id: problemId, from } });
    }
  };

  return (
    <View style={layout.block}>
      {flow.picks.length === 0 ? null : (
        <View style={layout.tiles} accessibilityLabel={t('problems.additions.files')}>
          {flow.picks.map((pick) => (
            <PickTile
              key={pick.captured.id}
              pick={pick}
              canRemove={!isLocked && pick.status !== 'uploading' && pick.status !== 'done'}
              onRemove={() => removePick(problemId, pick.captured.id)}
              styles={styles}
            />
          ))}
        </View>
      )}
      {flow.picks
        .filter((pick) => pick.status === 'failed')
        .map((pick, index) => (
          <View key={pick.captured.id}>
            <Text tone="danger" variant="caption">
              {t('problems.additions.failed', { name: tileName(pick, index, t) })}
            </Text>
            <FailureText error={pick.error} />
          </View>
        ))}
      {notice !== null ? (
        <Text accessibilityLiveRegion="polite" tone="secondary">
          {notice}
        </Text>
      ) : null}
      <View style={layout.buttons}>
        <Button
          variant="outline"
          label={t('problems.additions.takePhoto')}
          isDisabled={!canAdd}
          onPress={() => void takePhoto('camera')}
        />
        <Button
          variant="outline"
          label={t('problems.additions.fromGallery')}
          isDisabled={!canAdd}
          onPress={() => void takePhoto('gallery')}
        />
        <Button
          variant="outline"
          label={t('problems.additions.takeVideo')}
          isDisabled={!canAdd}
          onPress={() => takeVideo('camera')}
        />
        <Button
          variant="outline"
          label={t('problems.additions.videoFromGallery')}
          isDisabled={!canAdd}
          onPress={() => takeVideo('gallery')}
        />
      </View>
    </View>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** «Фото 2», «Видео 3»: what the reader hears and the failure line names. */
function tileName(pick: OfficePick, index: number, t: Translate): string {
  const kind =
    pick.captured.kind === 'video'
      ? t('problems.additions.fileVideo')
      : t('problems.additions.filePhoto');
  return `${kind} ${index + 1}`;
}

interface PickTileProps {
  pick: OfficePick;
  canRemove: boolean;
  onRemove: () => void;
  styles: ReturnType<typeof createStyles>;
}

/** One picked file: its picture or its length, where it is, and «Убрать». */
function PickTile({ pick, canRemove, onRemove, styles }: PickTileProps) {
  const { t } = useTranslation();
  const { captured } = pick;
  const name =
    captured.kind === 'video'
      ? t('problems.additions.fileVideo')
      : t('problems.additions.filePhoto');
  return (
    <View
      testID="office-pick"
      accessible
      accessibilityLabel={`${name}: ${t(`media.status.${statusWord(pick.status)}`)}`}
      style={[styles.tile, pick.status === 'failed' && styles.failed]}
    >
      {captured.kind === 'video' ? (
        <View style={[styles.picture, styles.video]}>
          <Text weight={700} tone="secondary">
            {name}
          </Text>
          {captured.durationSec === null ? null : (
            <Text variant="caption" tone="secondary">
              {`${Math.round(captured.durationSec)} s`}
            </Text>
          )}
        </View>
      ) : (
        <Image source={{ uri: mediaFileUri(captured.uri) }} contentFit="cover" style={styles.picture} />
      )}
      {pick.status === 'done' ? (
        <View style={styles.badge}>
          <Icon name="status.done" tone="primary" />
        </View>
      ) : null}
      {canRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('problems.additions.remove', { name })}
          hitSlop={Spacing.sm}
          onPress={onRemove}
          style={styles.remove}
        >
          <Icon name="action.close" tone="secondary" />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The strip's words for a file's state (media.status.*). */
function statusWord(status: OfficePick['status']): string {
  switch (status) {
    case 'uploading':
      return 'uploading';
    case 'done':
      return 'uploaded';
    case 'failed':
      return 'failed';
    case 'ready':
      return 'local';
  }
}

const TILE = 96;

const layout = StyleSheet.create({
  block: { gap: Spacing.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  buttons: { gap: Spacing.sm },
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
    failed: { borderColor: theme.danger, borderWidth: 2 },
    picture: { width: '100%', height: '100%' },
    video: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: theme.surfaceAlt,
    },
    badge: { position: 'absolute', right: Spacing.xs, bottom: Spacing.xs },
    remove: {
      position: 'absolute',
      top: 0,
      right: 0,
      minWidth: MIN_TOUCH_TARGET / 2,
      minHeight: MIN_TOUCH_TARGET / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.background,
      borderBottomLeftRadius: Radius.md,
    },
  });
