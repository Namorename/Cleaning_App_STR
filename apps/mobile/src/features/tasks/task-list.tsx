import { useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import { TaskCard } from './task-card';
import type { CleaningTask, TaskGroup } from './schema';

interface TaskListProps {
  sections: TaskGroup[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  emptyMessage: string;
  onClaim?: (taskId: string) => void;
  /** Her own list: accepting a cleaning without opening it. */
  onAccept?: (task: CleaningTask) => void;
  onPress?: (taskId: string) => void;
  claimingTaskId?: string | null;
  /** Her cleanings whose accept is on its way; several may be at once. */
  acceptingTaskIds?: ReadonlySet<string>;
  /** The jobs somebody has written about since she last looked. */
  unreadTaskIds?: ReadonlySet<string>;
  /**
   * The reports somebody has written about. A repair speaks in its report's
   * thread (open_thread), so a repair card lights up by its problem, not its id.
   */
  unreadProblemIds?: ReadonlySet<string>;
  /** Drawn above the cards: a line about what a tapped push could not open. */
  header?: ReactElement;
}

/**
 * Loading, error and empty are three different answers and the cleaner needs
 * to tell them apart: "nothing to do" and "could not load" mean opposite
 * things when she is standing in a doorway deciding where to go next. All
 * three are text a screen reader can reach, not just a spinner.
 *
 * Only the group of work under way gets a heading: a single unnamed list is
 * the queue; a list with "under way" at the top is her day.
 */
export function TaskList({
  sections,
  isLoading,
  error,
  onRefresh,
  isRefreshing,
  emptyMessage,
  onClaim,
  onAccept,
  onPress,
  claimingTaskId = null,
  acceptingTaskIds,
  unreadTaskIds,
  unreadProblemIds,
  header,
}: TaskListProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  const renderItem = useCallback(
    ({ item }: { item: CleaningTask }) => (
      <TaskCard
        task={item}
        onClaim={onClaim}
        onAccept={onAccept}
        onPress={onPress}
        isClaiming={claimingTaskId === item.id}
        isAccepting={acceptingTaskIds?.has(item.id) ?? false}
        hasUnread={
          (unreadTaskIds?.has(item.id) ?? false) ||
          (item.problem != null && (unreadProblemIds?.has(item.problem.id) ?? false))
        }
      />
    ),
    [onClaim, onAccept, onPress, claimingTaskId, acceptingTaskIds, unreadTaskIds, unreadProblemIds],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: TaskGroup }) =>
      section.key === 'running' ? (
        <Text style={styles.heading}>{t('tasks.status.inProgress')}</Text>
      ) : null,
    [styles.heading, t],
  );

  const keyExtractor = useCallback((item: CleaningTask) => item.id, []);

  const refreshControl = (
    // The spinner is drawn by the platform and defaults to a dark tick on
    // iOS — invisible on the dark background without this.
    <RefreshControl
      refreshing={isRefreshing}
      onRefresh={onRefresh}
      tintColor={styles.message.color}
      colors={[styles.message.color]}
    />
  );

  if (isLoading) {
    return (
      <View style={[styles.screen, styles.centered]} accessibilityLiveRegion="polite">
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('tasks.loading')}</Text>
      </View>
    );
  }

  if (error !== null && sections === undefined) {
    const failure = serverErrorText(error);

    // Pulled down like the list it stands in for, as its last line asks.
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.failure}
        refreshControl={refreshControl}
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.errorTitle}>{t('tasks.loadFailed')}</Text>
        <Text style={styles.message}>{failure.text}</Text>
        {failure.detail !== null ? (
          <Text style={styles.errorDetail}>{failure.detail}</Text>
        ) : null}
        <Text style={styles.message}>{t('tasks.pullToRetry')}</Text>
      </ScrollView>
    );
  }

  // Error over cache: a refresh that failed still has the list from the last
  // time it loaded, kept on the phone. The list stays, and a line above it
  // says what happened; the error screen above is for a list never loaded.
  const listHeader =
    error === null ? (
      header
    ) : (
      <>
        <ErrorBanner title={t('common.refreshFailed')} error={error} />
        {header}
      </>
    );

  return (
    <SectionList
      sections={sections ?? []}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      keyExtractor={keyExtractor}
      style={styles.screen}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
      SectionSeparatorComponent={Separator}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={listHeader}
      refreshControl={refreshControl}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.message}>{emptyMessage}</Text>
        </View>
      }
    />
  );
}

function Separator() {
  return <View style={layout.separator} />;
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  separator: { height: Spacing.md },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      padding: Spacing.lg,
      flexGrow: 1,
    },
    heading: {
      color: theme.textSecondary,
      fontSize: FontSize.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.sm,
    },
    // `centered` inside a scroll view: grows to the screen, scrolls past it at large type.
    failure: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.sm,
    },
    message: {
      fontSize: FontSize.body,
      color: theme.textSecondary,
      textAlign: 'center',
    },
    errorDetail: { fontSize: FontSize.caption, color: theme.textSecondary, textAlign: 'center' },
    errorTitle: {
      fontSize: FontSize.title,
      fontWeight: '600',
      color: theme.text,
      textAlign: 'center',
    },
  });
