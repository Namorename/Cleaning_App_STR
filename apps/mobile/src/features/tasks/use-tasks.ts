import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { stepKeys } from '@/features/steps/keys';

import { readCached } from '@/lib/read-cached';

import {
  acceptTask,
  type AcceptVariables,
  claimTask,
  fetchFreeTasks,
  fetchMyTasks,
  fetchTask,
  finishTask,
  startTask,
} from './api';
import { cleaningTaskListSchema, cleaningTaskSchema, type CleaningTask } from './schema';

/**
 * Tasks restored from disk come back in the shape the build that saved them
 * read (`readCached`): a column asked for since — the office's note — is
 * simply missing. Read through the schema, it is null instead of undefined.
 * Module-level so a query runs them only when its data changes.
 */
const oneOrNoTaskSchema = cleaningTaskSchema.nullable();

function readTasks(data: unknown): CleaningTask[] {
  return readCached(cleaningTaskListSchema, data, 'tasks');
}

function readTask(data: unknown): CleaningTask | null {
  return readCached(oneOrNoTaskSchema, data, 'task');
}

export const taskKeys = {
  all: ['tasks'] as const,
  mine: (cleanerId: string) => ['tasks', 'mine', cleanerId] as const,
  free: () => ['tasks', 'free'] as const,
  one: (taskId: string) => ['tasks', 'one', taskId] as const,
};

/**
 * Keys under which the moves are queued.
 *
 * A mutation that was paused for lack of signal is restored from disk on the
 * next launch as a key plus variables — the function behind it has to be
 * registered against the key, which `registerTaskMutations` does at startup.
 */
export const taskMutationKeys = {
  claim: ['tasks', 'claim'] as const,
  accept: ['tasks', 'accept'] as const,
  start: ['tasks', 'start'] as const,
  finish: ['tasks', 'finish'] as const,
};

export interface ClaimVariables {
  taskId: string;
  cleanerId: string;
}

/**
 * The moves of her cleanings go out one after another, in the order she
 * tapped them — a start landing before the accept she made first would turn
 * the accept into a refusal while she is cleaning. Persisted with a paused
 * move, like the chat's and the media queue's scopes.
 */
const TASK_MOVES_SCOPE = { id: 'task-moves' };

/** What an accept sends: the cleaning as the card showed it. */
export function acceptVariables(task: CleaningTask): AcceptVariables {
  return { taskId: task.id, scheduledDate: task.scheduled_date, propertyId: task.property_id };
}

/**
 * What a move of a cleaning changes: the cleanings, and that cleaning's steps
 * — a start is when the server copies its process into them, and a steps
 * query fetched a moment earlier, empty, would otherwise show no steps until
 * it went stale.
 */
function refreshAfterMove(queryClient: QueryClient, taskId: string): void {
  void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  void queryClient.invalidateQueries({ queryKey: stepKeys.byTask(taskId) });
}

/**
 * Teach the query client how to replay each move after a restart.
 *
 * Called once, before the persisted cache is restored; a paused mutation
 * restored without its default has nothing to run and is silently dropped.
 *
 * Settled, a move refreshes what it changes — here, as the uploads do: a move
 * restored from disk has no screen of its own, and one that lands after the
 * start stopped waiting for it (`MOVE_WAIT_MS`, lib/query-client.ts) left
 * the lists stale until the next refresh (MEDIUM-1 of the last review). This
 * is the only refresh of a move, from a screen too: a screen's hook keeps its
 * own options over these, merged, and refreshing there as well asked every
 * list twice (LOW-2 of the review of dab5237..cb747a5).
 */
export function registerTaskMutations(queryClient: QueryClient): void {
  queryClient.setMutationDefaults(taskMutationKeys.claim, {
    mutationFn: ({ taskId, cleanerId }: ClaimVariables) => claimTask(taskId, cleanerId),
    scope: TASK_MOVES_SCOPE,
    onSettled: (_task: unknown, _error: unknown, { taskId }: ClaimVariables) =>
      refreshAfterMove(queryClient, taskId),
  });
  queryClient.setMutationDefaults(taskMutationKeys.accept, {
    mutationFn: (variables: AcceptVariables) => acceptTask(variables),
    scope: TASK_MOVES_SCOPE,
    onSettled: (_task: unknown, _error: unknown, { taskId }: AcceptVariables) =>
      refreshAfterMove(queryClient, taskId),
  });
  queryClient.setMutationDefaults(taskMutationKeys.start, {
    mutationFn: (taskId: string) => startTask(taskId),
    scope: TASK_MOVES_SCOPE,
    onSettled: (_task: unknown, _error: unknown, taskId: string) =>
      refreshAfterMove(queryClient, taskId),
  });
  queryClient.setMutationDefaults(taskMutationKeys.finish, {
    mutationFn: (taskId: string) => finishTask(taskId),
    scope: TASK_MOVES_SCOPE,
    onSettled: (_task: unknown, _error: unknown, taskId: string) =>
      refreshAfterMove(queryClient, taskId),
  });
}

export function useMyTasks() {
  const { userId } = useSession();

  return useQuery({
    queryKey: taskKeys.mine(userId ?? 'anonymous'),
    queryFn: () => fetchMyTasks(userId as string),
    select: readTasks,
    enabled: userId !== null,
  });
}

export function useFreeTasks() {
  const { userId } = useSession();

  return useQuery({
    queryKey: taskKeys.free(),
    queryFn: fetchFreeTasks,
    select: readTasks,
    enabled: userId !== null,
  });
}

export function useTask(taskId: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: taskKeys.one(taskId),
    queryFn: () => fetchTask(taskId),
    // The list's copy seeds the screen below, raw from disk like any other.
    select: readTask,
    // An empty id is "no task": a form opened from the list, not from a task.
    enabled: userId !== null && taskId !== '',
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

/**
 * Take a free task.
 *
 * Deliberately not optimistic: a claim can legitimately lose to a colleague
 * who tapped first, and showing the task as hers and then snatching it back
 * reads as a bug. The list refreshes once the server has decided — by the
 * move's default (`registerTaskMutations`), as for every move below.
 */
export function useClaimTask() {
  // The variables are the same shape registerTaskMutations expects, so a
  // claim paused without signal replays after a restart with both ids intact.
  return useMutation<CleaningTask, Error, ClaimVariables>({
    mutationKey: taskMutationKeys.claim,
    mutationFn: ({ taskId, cleanerId }) => claimTask(taskId, cleanerId),
    scope: TASK_MOVES_SCOPE,
  });
}

/**
 * Accept her cleaning.
 *
 * Not optimistic, for the same reason as the claim: the office may have given
 * the cleaning to someone else or moved it, and a card that says "accepted"
 * and then falls back reads as a bug. Paused without signal, it waits on disk
 * like any move and goes through once she has it.
 */
export function useAcceptTask() {
  const queryClient = useQueryClient();

  return useMutation<CleaningTask, Error, AcceptVariables>({
    mutationKey: taskMutationKeys.accept,
    mutationFn: acceptTask,
    scope: TASK_MOVES_SCOPE,
    // The row the server answered with goes into every copy at once: the
    // refetch the move's default asks for can take seconds on a weak signal,
    // and until it lands the card would offer "accept" again as if the tap had
    // done nothing. Refused, the same refetch shows what the cleaning is now.
    onSuccess: (accepted) => writeTask(queryClient, accepted),
  });
}

/** Put a task the server just answered with into every cached copy of it. */
function writeTask(queryClient: QueryClient, task: CleaningTask): void {
  queryClient.setQueriesData<CleaningTask[]>({ queryKey: taskKeys.all }, (tasks) =>
    Array.isArray(tasks) ? tasks.map((row) => (row.id === task.id ? task : row)) : tasks,
  );
  queryClient.setQueryData(taskKeys.one(task.id), task);
}

export function useStartTask() {
  return useMutation<CleaningTask, Error, string>({
    mutationKey: taskMutationKeys.start,
    mutationFn: startTask,
    scope: TASK_MOVES_SCOPE,
  });
}

export function useFinishTask() {
  return useMutation<CleaningTask, Error, string>({
    mutationKey: taskMutationKeys.finish,
    mutationFn: finishTask,
    scope: TASK_MOVES_SCOPE,
  });
}
