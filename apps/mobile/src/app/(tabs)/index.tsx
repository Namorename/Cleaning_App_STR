import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { TaskList } from '@/features/tasks/task-list';
import { useMyTasks } from '@/features/tasks/use-tasks';

export default function MyTasksScreen() {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useMyTasks();
  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <TaskList
      tasks={data}
      isLoading={isPending}
      error={error}
      onRefresh={onRefresh}
      isRefreshing={isRefetching}
      emptyMessage={t('tasks.emptyMine')}
    />
  );
}
