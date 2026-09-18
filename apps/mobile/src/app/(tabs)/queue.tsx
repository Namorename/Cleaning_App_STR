import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { useSession } from '@/features/auth/session';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { TaskList } from '@/features/tasks/task-list';
import type { TaskGroup } from '@/features/tasks/schema';
import { useClaimTask, useFreeTasks } from '@/features/tasks/use-tasks';

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

  const onClaim = useCallback(
    (taskId: string) => {
      if (userId === null) {
        return;
      }
      setClaimingTaskId(taskId);
      claim.mutate({ taskId, cleanerId: userId }, {
        // Losing the race is an ordinary outcome, not a failure of the app —
        // say who it affects and let the refreshed list show the truth.
        onError: (mutationError) => {
          Alert.alert(t('tasks.claimFailedTitle'), mutationError.message);
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
      onClaim={onClaim}
      claimingTaskId={claimingTaskId}
      unreadTaskIds={unread.tasks}
      emptyMessage={t('tasks.emptyQueue')}
    />
  );
}
