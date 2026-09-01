import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';

import { claimTask, fetchFreeTasks, fetchMyTasks } from './api';
import type { CleaningTask } from './schema';

export const taskKeys = {
  all: ['tasks'] as const,
  mine: (cleanerId: string) => ['tasks', 'mine', cleanerId] as const,
  free: () => ['tasks', 'free'] as const,
};

export function useMyTasks() {
  const { userId } = useSession();

  return useQuery({
    queryKey: taskKeys.mine(userId ?? 'anonymous'),
    queryFn: () => fetchMyTasks(userId as string),
    enabled: userId !== null,
  });
}

export function useFreeTasks() {
  const { userId } = useSession();

  return useQuery({
    queryKey: taskKeys.free(),
    queryFn: fetchFreeTasks,
    enabled: userId !== null,
  });
}

/**
 * Take a free task.
 *
 * Deliberately not optimistic: a claim can legitimately lose to a colleague
 * who tapped first, and showing the task as hers and then snatching it back
 * reads as a bug. The list refreshes once the server has decided.
 */
export function useClaimTask() {
  const queryClient = useQueryClient();
  const { userId } = useSession();

  return useMutation<CleaningTask, Error, string>({
    mutationFn: (taskId: string) => claimTask(taskId, userId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
