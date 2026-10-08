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
  type SectionListRenderItemInfo,
} from 'react-native';

import { ErrorBanner } from '@/components/error-banner';
import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import type { CleaningTask, TaskGroup } from './schema';
import { SectionHeading } from './section-heading';
import { TaskCard } from './task-card';

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
  /** Free cleanings whose claim is on its way; several may be at once. */
  claimingTaskIds?: ReadonlySet<string>;
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
 * The cards stand in sections — the work under way, then one per day — whose
 * headings stay on top while the day under them scrolls (5.4, variant 1).
 * Every card of the work under way is the current one: several can run at once.
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
  claimingTaskIds,
  acceptingTaskIds,
  unreadTaskIds,
  unreadProblemIds,
  header,
}: TaskListProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  const renderItem = useCallback(
    ({ item, section }: SectionListRenderItemInfo<CleaningTask, TaskGroup>) => (
      <TaskCard
        task={item}
        onClaim={onClaim}
        onAccept={onAccept}
        onPress={onPress}
        isClaiming={claimingTaskIds?.has(item.id) ?? false}
        isAccepting={acceptingTaskIds?.has(item.id) ?? false}
        hasUnread={
          (unreadTaskIds?.has(item.id) ?? false) ||
          (item.problem != null && (unreadProblemIds?.has(item.problem.id) ?? false))
        }
        isNow={section.kind === 'running'}
      />
    ),
    [onClaim, onAccept, onPress, claimingTaskIds, acceptingTaskIds, unreadTaskIds, unreadProblemIds],
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
    error === null && header === undefined ? undefined : (
      <View style={layout.listHeader}>
        {error === null ? null : <ErrorBanner title={t('common.refreshFailed')} error={error} />}
        {header}
      </View>
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
      stickySectionHeadersEnabled
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

function renderSectionHeader({ section }: { section: TaskGroup }) {
  return <SectionHeading section={section} />;
}

function Separator() {
  return <View style={layout.separator} />;
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  separator: { height: Spacing.sm },
  // The first heading starts at the top edge, where it also sticks; a line
  // above the cards keeps the gutter of the list.
  listHeader: { paddingTop: Spacing.lg },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.lg,
      flexGrow: 1,
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
