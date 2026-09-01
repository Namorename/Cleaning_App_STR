import { useCallback } from 'react';

import { TaskList } from '@/features/tasks/task-list';
import { useMyTasks } from '@/features/tasks/use-tasks';

export default function MyTasksScreen() {
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
      emptyMessage="Пока нет назначенных уборок. Загляните во «Свободные» — там могут быть задачи на ваших объектах."
    />
  );
}
