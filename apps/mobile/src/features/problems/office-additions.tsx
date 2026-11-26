import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorBanner } from '@/components/error-banner';
import { Text } from '@/components/text';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { PhotoViewerHost } from '@/features/media/photo-viewer-host';
import { useMediaUrls } from '@/features/media/use-media';
import { viewerItemsOf, type ViewerTile } from '@/features/media/viewer-items';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { currentClosingAddition, shownFiles, type Addition, type AdditionFile } from './additions';
import { formatReportedAt } from './format';
import { useAdditions } from './use-additions';

interface OfficeAdditionsProps {
  problemId: string;
  /** The office on an open task: «Добавить фото или видео». */
  canAdd: boolean;
  /** The task is closed: its current closing's batch is the closing block's. */
  isClosed: boolean;
}

/**
 * «Добавлено менеджером» (owner, 2026-11-26): the photos and videos the office added to the task,
 * batch by batch with who and when, opened in the viewer; «Добавить фото или видео» for the
 * office while the task is open. Nothing on a task the office added nothing to.
 */
export function OfficeAdditions({ problemId, canAdd, isClosed }: OfficeAdditionsProps) {
  const { t } = useTranslation();
  const additions = useAdditions(problemId);
  const closing = currentClosingAddition(additions.data ?? [], isClosed);
  const listed = (additions.data ?? []).filter(
    (addition) => addition !== closing && shownFiles(addition).length > 0,
  );
  if (!canAdd && listed.length === 0 && additions.error === null) {
    return null;
  }

  return (
    <View style={layout.block} testID="office-additions">
      <Text variant="caption" weight={700} tone="secondary">
        {t('problems.additions.title')}
      </Text>
      {additions.error !== null ? (
        <ErrorBanner title={t('common.refreshFailed')} error={additions.error} />
      ) : null}
      {listed.length === 0 && canAdd ? (
        <Text tone="secondary">{t('problems.additions.noneYet')}</Text>
      ) : null}
      {listed.map((addition) => (
        <AdditionBatch key={addition.id} addition={addition} />
      ))}
      {canAdd ? (
        <Button
          variant="outline"
          label={t('problems.additions.add')}
          onPress={() =>
            router.push({ pathname: '/problem/[id]/add-files', params: { id: problemId } })
          }
        />
      ) : null}
    </View>
  );
}

interface ClosingAdditionProps {
  problemId: string;
}

/** What the manager sent with the closing: the comment and the files, beside who closed it. */
export function ClosingAddition({ problemId }: ClosingAdditionProps) {
  const { t } = useTranslation();
  const additions = useAdditions(problemId);
  const closing = currentClosingAddition(additions.data ?? [], true);
  if (closing === null) {
    return null;
  }
  return (
    <View style={layout.block} testID="closing-addition">
      <Text variant="caption" weight={700} tone="secondary">
        {t('problems.additions.atClosing')}
      </Text>
      {closing.message === null ? null : (
        <>
          <Text variant="caption" tone="secondary">
            {t('problems.additions.closingComment')}
          </Text>
          <Text>{closing.message.body}</Text>
        </>
      )}
      <AdditionBatch addition={closing} />
    </View>
  );
}

interface AdditionBatchProps {
  addition: Addition;
}

/** One batch: «Пётр, 26 нояб., 14:05» over its tiles. */
function AdditionBatch({ addition }: AdditionBatchProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const files = useMemo(() => shownFiles(addition), [addition]);
  const paths = useMemo(() => files.map((file) => file.storage_path), [files]);
  const urls = useMediaUrls(paths);
  const tiles = useMemo<(ViewerTile & { file: AdditionFile })[]>(
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

  return (
    <View style={layout.batch}>
      <Text variant="caption" tone="secondary">
        {t('problems.additions.by', {
          name: addition.author_name ?? t('problems.unknownPerson'),
          when: formatReportedAt(addition.published_at),
        })}
      </Text>
      {files.length === 0 ? null : (
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
                accessibilityLabel={t('media.openPhoto', { index: index + 1, total: tiles.length })}
                accessibilityHint={word}
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
                        {`${Math.round(tile.file.duration_sec)} s`}
                      </Text>
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
      {openId !== null ? (
        <PhotoViewerHost items={viewerItems} total={tiles.length} openId={openId} onClose={close} />
      ) : null}
    </View>
  );
}

const TILE = 88;

const layout = StyleSheet.create({
  block: { gap: Spacing.sm },
  batch: { gap: Spacing.xs },
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
