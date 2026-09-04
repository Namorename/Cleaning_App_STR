import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { groupMyTasks } from '@/features/tasks/schema';
import { TaskList } from '@/features/tasks/task-list';
import { useMyTasks } from '@/features/tasks/use-tasks';

export default function MyTasksScreen() {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useMyTasks();

  // Work under way first, as its own group: several cleanings run at once on
  // a floor, and this list is how she switches between them.
  const sections = useMemo(() => (data === undefined ? undefined : groupMyTasks(data)), [data]);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const onPress = useCallback((taskId: string) => {
    router.push({ pathname: '/task/[id]', params: { id: taskId } });
  }, []);

  return (
    <TaskList
      sections={sections}
      isLoading={isPending}
      error={error}
      onRefresh={onRefresh}
      isRefreshing={isRefetching}
      onPress={onPress}
      emptyMessage={t('tasks.emptyMine')}
    />
  );
}
