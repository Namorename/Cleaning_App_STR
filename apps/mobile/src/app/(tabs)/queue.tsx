import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { useSession } from '@/features/auth/session';
import { TaskList } from '@/features/tasks/task-list';
import type { TaskGroup } from '@/features/tasks/schema';
import { useClaimTask, useFreeTasks } from '@/features/tasks/use-tasks';

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

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

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
      emptyMessage={t('tasks.emptyQueue')}
    />
  );
}
