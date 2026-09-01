import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { TaskList } from '@/features/tasks/task-list';
import { useClaimTask, useFreeTasks } from '@/features/tasks/use-tasks';

export default function FreeQueueScreen() {
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
          Alert.alert('Не получилось взять задачу', mutationError.message);
          void refetch();
        },
        onSettled: () => setClaimingTaskId(null),
      });
    },
    [claim, refetch],
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
      emptyMessage="Свободных уборок на ваших объектах нет."
    />
  );
}
