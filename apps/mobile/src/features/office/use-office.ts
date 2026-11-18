import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { problemKeys } from '@/features/problems/keys';
import { refreshTaskLists } from '@/features/tasks/use-tasks';
import { readCached } from '@/lib/read-cached';

import {
  assignCleaning,
  fetchOfficeTask,
  fetchOfficeTasks,
  restoreCleaning,
  type AssignCleaningVariables,
} from './api';
import { runProblemAction, type ProblemAction } from './problem-api';
import { officeTaskListSchema, officeTaskSchema, type DayRange, type OfficeTask } from './schema';

/**
 * Under `tasks`, so whatever refreshes the cleanings — a move, a cancel, a push
 * (`refreshTaskLists`, push/destination.ts `staleAfter`) — refreshes the
 * office's too. Not keyed by the person: a phone handed to somebody else
 * forgets the lists it kept (features/auth/forget-on-sign-out.ts).
 */
export const officeKeys = {
  lists: ['tasks', 'office', 'list'] as const,
  list: (range: DayRange) => ['tasks', 'office', 'list', range.from, range.to] as const,
  one: (taskId: string) => ['tasks', 'office', 'one', taskId] as const,
  /** The office's moves on a cleaning: one key, so one holds the other. */
  dispatch: ['office', 'dispatch'] as const,
  /** The manager's levers on a task. */
  problem: ['office', 'problem'] as const,
};

/** Module-level, so a query runs them only when its data changes. */
const oneOrNoOfficeTaskSchema = officeTaskSchema.nullable();

function readOfficeTasks(data: unknown): OfficeTask[] {
  return readCached(officeTaskListSchema, data, 'office tasks');
}

function readOfficeTask(data: unknown): OfficeTask | null {
  return readCached(oneOrNoOfficeTaskSchema, data, 'office task');
}

/**
 * The company's cleanings on the days of `range` (≤ 62), as the office's «Уборки» lists them.
 * Read with a signal for the session only: every range a manager looks through would otherwise
 * stay in the one value the disk keeps the cache in, and swell it past what the phone can store.
 */
export function useOfficeTasks(range: DayRange) {
  const { userId } = useSession();

  return useQuery({
    queryKey: officeKeys.list(range),
    queryFn: () => fetchOfficeTasks(range),
    select: readOfficeTasks,
    enabled: userId !== null,
    meta: { persist: false },
  });
}

/**
 * One job for the office's card. The list's copy stands in at once, but the
 * card's moves are decided on what the server says now — as the head
 * technician's hand-out is (features/board/use-board.ts) — so it is read
 * again every time the card opens.
 */
export function useOfficeTask(taskId: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: officeKeys.one(taskId),
    queryFn: () => fetchOfficeTask(taskId),
    select: readOfficeTask,
    enabled: userId !== null && taskId !== '',
    initialData: () =>
      queryClient
        .getQueriesData({ queryKey: officeKeys.lists })
        .flatMap(([, data]) => (Array.isArray(data) ? data : []))
        .find((task): task is OfficeTask => (task as { id?: unknown } | null)?.id === taskId),
    initialDataUpdatedAt: 0,
    refetchOnMount: 'always',
  });
}

/**
 * The office's moves are dispatch, as a cancel is (features/tasks/use-cleaning-off.ts):
 * sent at once or not at all, one try, never paused on disk and never replayed
 * — a hand-out sent hours later would overrule what the office did since.
 */
const DISPATCH = { mutationKey: officeKeys.dispatch, networkMode: 'always', retry: false } as const;

/**
 * «Назначить» / «Переназначить». Settled either way, the cleanings are read
 * again — a refusal too: «Это уже изменилось — экран обновлён» must be true —
 * and the move stays pending until that read lands, so the sheet closes over
 * the card that shows the new person.
 */
export function useAssignCleaning() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, AssignCleaningVariables>({
    mutationFn: assignCleaning,
    ...DISPATCH,
    onSettled: () => refreshTaskLists(queryClient),
  });
}

/** «Вернуть»: a cleaning back from the office's cancel; «Выполненные» may gain it back. */
export function useRestoreCleaning() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: restoreCleaning,
    ...DISPATCH,
    onSettled: () => refreshTaskLists(queryClient, { withDone: true }),
  });
}

/**
 * The manager's levers on a task: sent at once or not at all, and the tasks —
 * board, screens, history — read again before the move counts as done; the
 * jobs beside them, not waited for (a cancel or an archive closes a repair).
 */
export function useProblemAction() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ProblemAction>({
    mutationFn: runProblemAction,
    mutationKey: officeKeys.problem,
    networkMode: 'always',
    retry: false,
    onSettled: () => {
      void refreshTaskLists(queryClient);
      return queryClient.invalidateQueries({ queryKey: problemKeys.all });
    },
  });
}
