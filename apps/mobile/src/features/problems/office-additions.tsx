import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorBanner } from '@/components/error-banner';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';

import { currentClosingAddition, shownFiles, type Addition } from './additions';
import { formatReportedAt } from './format';
import { MediaTiles } from './media-tiles';
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
  const files = useMemo(() => shownFiles(addition), [addition]);

  return (
    <View style={layout.batch}>
      <Text variant="caption" tone="secondary">
        {t('problems.additions.by', {
          name: addition.author_name ?? t('problems.unknownPerson'),
          when: formatReportedAt(addition.published_at),
        })}
      </Text>
      <MediaTiles files={files} />
    </View>
  );
}

const layout = StyleSheet.create({
  block: { gap: Spacing.sm },
  batch: { gap: Spacing.xs },
});
