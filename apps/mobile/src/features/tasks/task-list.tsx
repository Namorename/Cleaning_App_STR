import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { TaskCard } from './task-card';
import type { CleaningTask } from './schema';

interface TaskListProps {
  tasks: CleaningTask[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  emptyMessage: string;
  onClaim?: (taskId: string) => void;
  claimingTaskId?: string | null;
}

/**
 * Loading, error and empty are three different answers and the cleaner needs
 * to tell them apart: "nothing to do" and "could not load" mean opposite
 * things when she is standing in a doorway deciding where to go next. All
 * three are text a screen reader can reach, not just a spinner.
 */
export function TaskList({
  tasks,
  isLoading,
  error,
  onRefresh,
  isRefreshing,
  emptyMessage,
  onClaim,
  claimingTaskId = null,
}: TaskListProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  const renderItem = useCallback(
    ({ item }: { item: CleaningTask }) => (
      <TaskCard task={item} onClaim={onClaim} isClaiming={claimingTaskId === item.id} />
    ),
    [onClaim, claimingTaskId],
  );

  const keyExtractor = useCallback((item: CleaningTask) => item.id, []);

  if (isLoading) {
    return (
      <View style={[styles.screen, styles.centered]} accessibilityLiveRegion="polite">
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('tasks.loading')}</Text>
      </View>
    );
  }

  if (error !== null) {
    return (
      <View style={[styles.screen, styles.centered]} accessibilityLiveRegion="polite">
        <Text style={styles.errorTitle}>{t('tasks.loadFailed')}</Text>
        <Text style={styles.message}>{error.message}</Text>
        <Text style={styles.message}>{t('tasks.pullToRetry')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={tasks ?? []}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      style={styles.screen}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
      refreshControl={
        // The spinner is drawn by the platform and defaults to a dark tick on
        // iOS — invisible on the dark background without this.
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={styles.message.color}
          colors={[styles.message.color]}
        />
      }
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
    centered: {
      flex: 1,
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
    errorTitle: {
      fontSize: FontSize.title,
      fontWeight: '600',
      color: theme.text,
      textAlign: 'center',
    },
  });
