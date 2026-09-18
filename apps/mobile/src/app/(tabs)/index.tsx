import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUnreadSubjects } from '@/features/chat/use-chat';
import { groupMyTasks } from '@/features/tasks/schema';
import { TaskList } from '@/features/tasks/task-list';
import { useMyTasks } from '@/features/tasks/use-tasks';

const NO_IDS: readonly string[] = [];

export default function MyTasksScreen() {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useMyTasks();

  // Work under way first, as its own group: several cleanings run at once on
  // a floor, and this list is how she switches between them.
  const sections = useMemo(() => (data === undefined ? undefined : groupMyTasks(data)), [data]);

  // The marks are asked for exactly the jobs on this screen.
  const taskIds = useMemo(
    () => (data === undefined ? NO_IDS : data.map((task) => task.id)),
    [data],
  );
  const unread = useUnreadSubjects(taskIds, NO_IDS);

  const onRefresh = useCallback(() => {
    void refetch();
    unread.refetch();
  }, [refetch, unread]);

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
      unreadTaskIds={unread.tasks}
      emptyMessage={t('tasks.emptyMine')}
    />
  );
}
