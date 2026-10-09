import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { problemKeys } from '@/features/problems/keys';
import { taskKeys } from '@/features/tasks/use-tasks';
import { readCached } from '@/lib/read-cached';

import {
  assignProblem,
  fetchBoardProblem,
  fetchBoardProblems,
  fetchStaffDirectory,
  unassignProblem,
  type AssignProblemVariables,
  type UnassignProblemVariables,
} from './api';
import { boardKeys } from './keys';
import {
  boardProblemListSchema,
  boardProblemSchema,
  staffListSchema,
  type BoardProblem,
  type StaffMember,
} from './schema';

/**
 * Restored from disk in whatever shape the build that saved it read
 * (`readCached`). Module-level, so a query runs them only when its data changes.
 */
const oneOrNoBoardProblemSchema = boardProblemSchema.nullable();

function readBoard(data: unknown): BoardProblem[] {
  return readCached(boardProblemListSchema, data, 'board');
}

function readBoardProblem(data: unknown): BoardProblem | null {
  return readCached(oneOrNoBoardProblemSchema, data, 'board task');
}

function readStaff(data: unknown): StaffMember[] {
  return readCached(staffListSchema, data, 'staff');
}

/** Every task of the company, for the head technician's «Задания». */
export function useBoardProblems() {
  const { userId } = useSession();

  return useQuery({
    queryKey: boardKeys.list(userId ?? ''),
    queryFn: fetchBoardProblems,
    select: readBoard,
    enabled: userId !== null,
  });
}

/** One task as the board reads it, for «Назначить» and «Снять» on its screen. */
export function useBoardProblem(problemId: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: boardKeys.one(userId ?? '', problemId),
    queryFn: () => fetchBoardProblem(problemId),
    select: readBoardProblem,
    enabled: userId !== null && problemId !== '',
    // The board's copy stands in until the task's own arrives, raw from disk like any other.
    initialData: () =>
      queryClient
        .getQueryData<BoardProblem[]>(boardKeys.list(userId ?? ''))
        ?.find((problem) => problem.id === problemId),
    initialDataUpdatedAt: 0,
  });
}

/** The company's people by name: the board's and the history's names. */
export function useStaffDirectory() {
  const { userId } = useSession();

  return useQuery({
    queryKey: boardKeys.staff(userId ?? ''),
    queryFn: fetchStaffDirectory,
    select: readStaff,
    enabled: userId !== null,
  });
}

/**
 * After a move, whatever came of it: the tasks (board, lists, screens, their
 * history) and the jobs — his own «Мои работы» gains a repair he gave himself.
 * A refusal refreshes too: «Это уже изменилось — экран обновлён» must be true.
 */
function refreshAfterMove(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: problemKeys.all });
  void queryClient.invalidateQueries({ queryKey: taskKeys.all });
}

/**
 * The head technician's moves are dispatch, not field reports (brief, tech-plan
 * §3.3): online only, never paused on disk and never replayed — a hand-out
 * sent hours later, after a restart, would overrule what the office decided
 * since. One attempt; a failure is said on the screen, nothing changes on the
 * phone until the server is read again.
 */
const DISPATCH = { networkMode: 'always', retry: false } as const;

export function useAssignProblem() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, AssignProblemVariables>({
    mutationFn: assignProblem,
    ...DISPATCH,
    onSettled: () => refreshAfterMove(queryClient),
  });
}

export function useUnassignProblem() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, UnassignProblemVariables>({
    mutationFn: unassignProblem,
    ...DISPATCH,
    onSettled: () => refreshAfterMove(queryClient),
  });
}
