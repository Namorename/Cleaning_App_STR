import { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing } from '@/constants/theme';

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
 * to tell them apart: "нет задач" and "не удалось загрузить" mean opposite
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
  const renderItem = useCallback(
    ({ item }: { item: CleaningTask }) => (
      <TaskCard task={item} onClaim={onClaim} isClaiming={claimingTaskId === item.id} />
    ),
    [onClaim, claimingTaskId],
  );

  const keyExtractor = useCallback((item: CleaningTask) => item.id, []);

  if (isLoading) {
    return (
      <View style={styles.centered} accessibilityLiveRegion="polite">
        <ActivityIndicator />
        <Text style={styles.message}>Загружаем задачи…</Text>
      </View>
    );
  }

  if (error !== null) {
    return (
      <View style={styles.centered} accessibilityLiveRegion="polite">
        <Text style={styles.errorTitle}>Не удалось загрузить задачи</Text>
        <Text style={styles.message}>{error.message}</Text>
        <Text style={styles.message}>Потяните список вниз, чтобы повторить.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={tasks ?? []}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.message}>{emptyMessage}</Text>
        </View>
      }
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.lg,
    flexGrow: 1,
  },
  separator: { height: Spacing.md },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  message: {
    fontSize: FontSize.body,
    color: '#60646C',
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: FontSize.title,
    fontWeight: '600',
    textAlign: 'center',
  },
});
