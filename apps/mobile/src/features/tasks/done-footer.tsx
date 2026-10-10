import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';

import { DONE_HISTORY_DAYS } from './done';
import type { CleaningTask } from './schema';

interface DoneFooterProps {
  isOpen: boolean;
  /** Her finished jobs as read so far; undefined until the first page has come. */
  tasks: readonly CleaningTask[] | undefined;
  error: Error | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  onOpen: () => void;
  onMore: () => void;
  onRetry: () => void;
}

/**
 * The end of «Мои»: «Выполненные за 30 дней» as a button until she asks for
 * them (owner, 2026-10-10) — nothing is read before — and then what the list
 * of them cannot say itself: that it is loading, that it failed, that the
 * window holds nothing, or «Показать ещё» while a full page says there may be
 * more. Once there are jobs, their heading is the list's own section heading.
 */
export function DoneFooter({
  isOpen,
  tasks,
  error,
  hasMore,
  isLoadingMore,
  onOpen,
  onMore,
  onRetry,
}: DoneFooterProps) {
  const { t } = useTranslation();
  const heading = t('tasks.done.heading', { count: DONE_HISTORY_DAYS });

  if (!isOpen) {
    return (
      <View style={layout.footer}>
        <Button variant="outline" label={heading} onPress={onOpen} />
      </View>
    );
  }

  if (tasks === undefined || tasks.length === 0) {
    return (
      <View style={layout.footer}>
        <Text variant="title" accessibilityRole="header">
          {heading}
        </Text>
        <DoneState tasks={tasks} error={error} onRetry={onRetry} />
      </View>
    );
  }

  if (!hasMore && error === null) {
    return null;
  }

  return (
    <View style={layout.footer}>
      {/* «Показать ещё» that failed: said beside the button that retries it. */}
      {error === null ? null : <FailureText error={error} />}
      {hasMore ? (
        <Button
          variant="outline"
          label={t('tasks.done.more')}
          isBusy={isLoadingMore}
          onPress={onMore}
        />
      ) : null}
    </View>
  );
}

interface DoneStateProps {
  tasks: readonly CleaningTask[] | undefined;
  error: Error | null;
  onRetry: () => void;
}

/** Before the first page, or a window with nothing in it. */
function DoneState({ tasks, error, onRetry }: DoneStateProps) {
  const { t } = useTranslation();

  if (tasks !== undefined) {
    return <Text tone="secondary">{t('tasks.done.empty')}</Text>;
  }
  if (error !== null) {
    return (
      <View style={layout.failure} accessibilityLiveRegion="polite">
        <Text tone="danger">{t('tasks.done.loadFailed')}</Text>
        <FailureText error={error} />
        <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
      </View>
    );
  }
  return (
    <Text tone="secondary" accessibilityLiveRegion="polite">
      {t('tasks.done.loading')}
    </Text>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  footer: { paddingTop: Spacing.lg, gap: Spacing.sm },
  failure: { gap: Spacing.sm },
});
