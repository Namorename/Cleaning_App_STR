import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { TaskList } from '@/features/tasks/task-list';
import { useClaimTask, useFreeTasks } from '@/features/tasks/use-tasks';

export default function FreeQueueScreen() {
  const { t } = useTranslation();
  const { data, isPending, error, refetch, isRefetching } = useFreeTasks();
  const claim = useClaimTask();
  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const onClaim = useCallback(
    (taskId: string) => {
      setClaimingTaskId(taskId);
      claim.mutate(taskId, {
        // Losing the race is an ordinary outcome, not a failure of the app —
        // say who it affects and let the refreshed list show the truth.
        onError: (mutationError) => {
          Alert.alert(t('tasks.claimFailedTitle'), mutationError.message);
          void refetch();
        },
        onSettled: () => setClaimingTaskId(null),
      });
    },
    [claim, refetch, t],
  );

  return (
    <TaskList
      tasks={data}
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
