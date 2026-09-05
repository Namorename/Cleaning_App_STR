import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { taskKeys } from '@/features/tasks/use-tasks';

import {
  completeStep,
  fetchTaskSteps,
  openStep,
  reopenStep,
  skipStep,
  type CompleteStepVariables,
  type SkipStepVariables,
  type StepVariables,
} from './api';
import { stepKeys } from './keys';
import type { TaskStep } from './schema';

export { stepKeys };

/**
 * Keys under which step actions are queued.
 *
 * Same arrangement as the task moves: an action paused for lack of signal is
 * restored from disk as a key plus variables, and the function behind the key
 * has to be registered before the cache is restored.
 */
export const stepMutationKeys = {
  open: ['steps', 'open'] as const,
  complete: ['steps', 'complete'] as const,
  reopen: ['steps', 'reopen'] as const,
  skip: ['steps', 'skip'] as const,
};

/** Teach the query client how to replay each step action after a restart. */
export function registerStepMutations(queryClient: QueryClient): void {
  queryClient.setMutationDefaults(stepMutationKeys.open, {
    mutationFn: (variables: StepVariables) => openStep(variables),
  });
  queryClient.setMutationDefaults(stepMutationKeys.complete, {
    mutationFn: (variables: CompleteStepVariables) => completeStep(variables),
  });
  queryClient.setMutationDefaults(stepMutationKeys.reopen, {
    mutationFn: (variables: StepVariables) => reopenStep(variables),
  });
  queryClient.setMutationDefaults(stepMutationKeys.skip, {
    mutationFn: (variables: SkipStepVariables) => skipStep(variables),
  });
}

export function useTaskSteps(taskId: string) {
  const { userId } = useSession();

  return useQuery({
    queryKey: stepKeys.byTask(taskId),
    queryFn: () => fetchTaskSteps(taskId),
    enabled: userId !== null && taskId !== '',
  });
}

interface StepMutationContext {
  previous: TaskStep[] | undefined;
}

/**
 * One step action with an optimistic update of that step in the task's list.
 *
 * The row is patched at once so the tick appears under her finger, rolled
 * back if the server refuses, and replaced by the server's row on settle.
 * Both the steps and the task itself are refreshed afterwards: finishing
 * depends on the steps, and the task list shows the count.
 */
function useStepMutation<TVariables extends StepVariables>(
  mutationKey: QueryKey,
  mutationFn: (variables: TVariables) => Promise<TaskStep>,
  patch: (step: TaskStep, variables: TVariables) => TaskStep,
) {
  const queryClient = useQueryClient();

  return useMutation<TaskStep, Error, TVariables, StepMutationContext>({
    mutationKey,
    mutationFn,
    onMutate: async (variables) => {
      const key = stepKeys.byTask(variables.taskId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskStep[]>(key);

      queryClient.setQueryData<TaskStep[]>(key, (steps) =>
        steps?.map((step) => (step.id === variables.stepId ? patch(step, variables) : step)),
      );

      return { previous };
    },
    onError: (_error, variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(stepKeys.byTask(variables.taskId), context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: stepKeys.byTask(variables.taskId) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useOpenStep() {
  return useStepMutation<StepVariables>(stepMutationKeys.open, openStep, (step) => ({
    ...step,
    started_at: step.started_at ?? new Date().toISOString(),
  }));
}

export function useCompleteStep() {
  return useStepMutation<CompleteStepVariables>(
    stepMutationKeys.complete,
    completeStep,
    (step, { payload, deviceCompletedAt }) => ({
      ...step,
      completed_at: deviceCompletedAt,
      payload:
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? payload
          : {},
      skipped_at: null,
      skip_reason: null,
    }),
  );
}

export function useReopenStep() {
  return useStepMutation<StepVariables>(stepMutationKeys.reopen, reopenStep, (step) => ({
    ...step,
    completed_at: null,
    completed_by: null,
    skipped_at: null,
    skip_reason: null,
  }));
}

export function useSkipStep() {
  return useStepMutation<SkipStepVariables>(
    stepMutationKeys.skip,
    skipStep,
    (step, { reason }) => ({
      ...step,
      skipped_at: new Date().toISOString(),
      skip_reason: reason ?? null,
      completed_at: null,
      completed_by: null,
    }),
  );
}
