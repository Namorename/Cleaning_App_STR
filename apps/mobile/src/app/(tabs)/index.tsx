import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { useUnreadSubjects } from '@/features/chat/use-chat';
import { groupMyTasks } from '@/features/tasks/schema';
import { TaskList } from '@/features/tasks/task-list';
import type { CleaningTask } from '@/features/tasks/schema';
import { acceptVariables, useAcceptTask, useMyTasks } from '@/features/tasks/use-tasks';
import { alertMessage, serverErrorText } from '@/lib/server-error';

const NO_IDS: readonly string[] = [];
const NO_ACCEPTS: ReadonlySet<string> = new Set();

export default function MyTasksScreen() {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useMyTasks();
  const { mutateAsync: accept } = useAcceptTask();
  const [acceptingIds, setAcceptingIds] = useState<ReadonlySet<string>>(NO_ACCEPTS);

  // Work under way first, as its own group: several cleanings run at once on
  // a floor, and this list is how she switches between them.
  const sections = useMemo(() => (data === undefined ? undefined : groupMyTasks(data)), [data]);

  // The marks are asked for exactly the jobs on this screen. A repair speaks
  // in its report's thread, so its report is asked about too.
  const taskIds = useMemo(
    () => (data === undefined ? NO_IDS : data.map((task) => task.id)),
    [data],
  );
  const problemIds = useMemo(
    () =>
      data === undefined
        ? NO_IDS
        : data.flatMap((task) => (task.problem == null ? [] : [task.problem.id])),
    [data],
  );
  const unread = useUnreadSubjects(taskIds, problemIds);

  const onRefresh = useCallback(() => {
    void refetch();
    unread.refetch();
  }, [refetch, unread]);

  const onPress = useCallback((taskId: string) => {
    router.push({ pathname: '/task/[id]', params: { id: taskId } });
  }, []);

  // Tomorrow's cleanings are accepted from the list, one card after another,
  // without opening each. Every card keeps its own promise: the callbacks of
  // an earlier mutate() are dropped once a later one is made, and a refusal
  // for the first card must not be lost because she tapped the second. A
  // refusal means the office changed it — given to someone else, moved or
  // cancelled — so she is told, and the refreshed list shows what it is now.
  const onAccept = useCallback(
    (task: CleaningTask) => {
      const taskId = task.id;
      setAcceptingIds((ids) => new Set(ids).add(taskId));
      accept(acceptVariables(task))
        .catch((mutationError: unknown) => {
          Alert.alert(t('tasks.acceptFailedTitle'), alertMessage(serverErrorText(mutationError)));
          void refetch();
        })
        .finally(() =>
          setAcceptingIds((ids) => {
            const rest = new Set(ids);
            rest.delete(taskId);
            return rest;
          }),
        );
    },
    [accept, refetch, t],
  );

  return (
    <TaskList
      sections={sections}
      isLoading={isPending}
      error={error}
      onRefresh={onRefresh}
      isRefreshing={isRefetching}
      onPress={onPress}
      onAccept={onAccept}
      acceptingTaskIds={acceptingIds}
      unreadTaskIds={unread.tasks}
      unreadProblemIds={unread.problems}
      emptyMessage={t('tasks.emptyMine')}
    />
  );
}
