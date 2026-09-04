import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';

import { claimTask, fetchFreeTasks, fetchMyTasks, fetchTask, finishTask, startTask } from './api';
import type { CleaningTask } from './schema';

export const taskKeys = {
  all: ['tasks'] as const,
  mine: (cleanerId: string) => ['tasks', 'mine', cleanerId] as const,
  free: () => ['tasks', 'free'] as const,
  one: (taskId: string) => ['tasks', 'one', taskId] as const,
};

/**
 * Keys under which the three moves are queued.
 *
 * A mutation that was paused for lack of signal is restored from disk on the
 * next launch as a key plus variables — the function behind it has to be
 * registered against the key, which `registerTaskMutations` does at startup.
 */
export const taskMutationKeys = {
  claim: ['tasks', 'claim'] as const,
  start: ['tasks', 'start'] as const,
  finish: ['tasks', 'finish'] as const,
};

interface ClaimVariables {
  taskId: string;
  cleanerId: string;
}

/**
 * Teach the query client how to replay each move after a restart.
 *
 * Called once, before the persisted cache is restored; a paused mutation
 * restored without its default has nothing to run and is silently dropped.
 */
export function registerTaskMutations(queryClient: QueryClient): void {
  queryClient.setMutationDefaults(taskMutationKeys.claim, {
    mutationFn: ({ taskId, cleanerId }: ClaimVariables) => claimTask(taskId, cleanerId),
  });
  queryClient.setMutationDefaults(taskMutationKeys.start, {
    mutationFn: (taskId: string) => startTask(taskId),
  });
  queryClient.setMutationDefaults(taskMutationKeys.finish, {
    mutationFn: (taskId: string) => finishTask(taskId),
  });
}

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

export function useTask(taskId: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: taskKeys.one(taskId),
    queryFn: () => fetchTask(taskId),
    enabled: userId !== null,
    // The list already holds this task more often than not: show it at once
    // and let the fetch confirm, rather than a spinner over known data.
    initialData: () =>
      queryClient
        .getQueriesData<CleaningTask[]>({ queryKey: taskKeys.all })
        .flatMap(([, tasks]) => (Array.isArray(tasks) ? tasks : []))
        .find((task) => task.id === taskId),
    initialDataUpdatedAt: 0,
  });
}

function useInvalidateTasks() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  };
}

/**
 * Take a free task.
 *
 * Deliberately not optimistic: a claim can legitimately lose to a colleague
 * who tapped first, and showing the task as hers and then snatching it back
 * reads as a bug. The list refreshes once the server has decided.
 */
export function useClaimTask() {
  const { userId } = useSession();
  const invalidate = useInvalidateTasks();

  return useMutation<CleaningTask, Error, string>({
    mutationKey: taskMutationKeys.claim,
    mutationFn: (taskId: string) => claimTask(taskId, userId as string),
    onSuccess: invalidate,
  });
}

export function useStartTask() {
  const invalidate = useInvalidateTasks();

  return useMutation<CleaningTask, Error, string>({
    mutationKey: taskMutationKeys.start,
    mutationFn: startTask,
    onSuccess: invalidate,
  });
}

export function useFinishTask() {
  const invalidate = useInvalidateTasks();

  return useMutation<CleaningTask, Error, string>({
    mutationKey: taskMutationKeys.finish,
    mutationFn: finishTask,
    onSuccess: invalidate,
  });
}
