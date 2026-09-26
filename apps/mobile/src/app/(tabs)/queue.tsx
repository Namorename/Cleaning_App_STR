import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { useSession } from '@/features/auth/session';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { TaskList } from '@/features/tasks/task-list';
import type { TaskGroup } from '@/features/tasks/schema';
import { useClaimTask, useFreeTasks } from '@/features/tasks/use-tasks';
import { alertMessage, serverErrorText } from '@/lib/server-error';

const NO_IDS: readonly string[] = [];

export default function FreeQueueScreen() {
  const { t } = useTranslation();
  const { userId } = useSession();
  const { data, isPending, error, refetch, isRefetching } = useFreeTasks();
  const claim = useClaimTask();
  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null);

  // One unnamed group: the queue has no work under way by definition.
  const sections = useMemo<TaskGroup[] | undefined>(
    () => (data === undefined ? undefined : [{ key: 'upcoming', data }]),
    [data],
  );

  // A note the office left on free work is the case the conversation exists
  // for, so the queue carries the marks too.
  const taskIds = useMemo(
    () => (data === undefined ? NO_IDS : data.map((task) => task.id)),
    [data],
  );
  const unread = useUnreadSubjects(taskIds, NO_IDS);

  const onRefresh = useCallback(() => {
    void refetch();
    unread.refetch();
  }, [refetch, unread]);

  // A free task opens before it is taken: the listing's notes and the
  // office's words in the chat are what she decides by. The task screen offers
  // the same claim.
  const onPress = useCallback((taskId: string) => {
    router.push({ pathname: '/task/[id]', params: { id: taskId } });
  }, []);

  const onClaim = useCallback(
    (taskId: string) => {
      if (userId === null) {
        return;
      }
      setClaimingTaskId(taskId);
      claim.mutate({ taskId, cleanerId: userId }, {
        // Losing the race is an ordinary outcome, not a failure of the app —
        // say who it affects and let the refreshed list show the truth. What
        // the server said in its own words is the second paragraph, never the
        // whole message.
        onError: (mutationError) => {
          Alert.alert(t('tasks.claimFailedTitle'), alertMessage(serverErrorText(mutationError)));
          void refetch();
        },
        onSettled: () => setClaimingTaskId(null),
      });
    },
    [claim, refetch, t, userId],
  );

  return (
    <TaskList
      sections={sections}
      isLoading={isPending}
      error={error}
      onRefresh={onRefresh}
      isRefreshing={isRefetching}
      onPress={onPress}
      onClaim={onClaim}
      claimingTaskId={claimingTaskId}
      unreadTaskIds={unread.tasks}
      emptyMessage={t('tasks.emptyQueue')}
    />
  );
}
