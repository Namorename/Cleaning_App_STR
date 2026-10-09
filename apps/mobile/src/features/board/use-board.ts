import {
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';

import { useSession } from '@/features/auth/session';
import { problemKeys } from '@/features/problems/keys';
import { taskKeys } from '@/features/tasks/use-tasks';
import { readCached } from '@/lib/read-cached';

import {
  ARCHIVE_PAGE_SIZE,
  assignProblem,
  fetchArchivePage,
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

/** The archive's pages as the infinite query keeps them, each page read through the schema. */
const archivePagesSchema = z.object({
  pages: z.array(boardProblemListSchema),
  pageParams: z.array(z.unknown()),
});

/** The archive's pages, one list in their order. */
function readArchive(data: unknown): BoardProblem[] {
  return readCached(archivePagesSchema, data, 'board archive').pages.flat();
}

/** Every task of the company, for the head technician's «Задания». */
export function useBoardProblems() {
  const { userId } = useSession();

  return useQuery({
    queryKey: boardKeys.list(userId ?? ''),
    // Called bare: the query's own context is not the day the window counts from.
    queryFn: () => fetchBoardProblems(),
    select: readBoard,
    enabled: userId !== null,
  });
}

/**
 * One task as the board reads it, for «Назначить» and «Снять» on its screen.
 *
 * The board's copy stands in at once, but it may be hours old — and so may a
 * copy of the task itself kept on the phone. A hand-out decided on either
 * would overrule what the office did since («last writer wins», tech-plan
 * §3.3), so the task is read from the server every time the screen opens,
 * however fresh the copy looks, and the moves wait for that read
 * (`isFetchedAfterMount` with no error: see `ProblemDispatch`).
 */
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
    refetchOnMount: 'always',
  });
}

/**
 * The archive (decision 7), read only once he opens it (`isOpen`) and then a
 * page at a time: a full page means there may be more, «Ещё» reads it.
 */
export function useBoardArchive(isOpen: boolean) {
  const { userId } = useSession();

  return useInfiniteQuery({
    queryKey: boardKeys.archive(userId ?? ''),
    queryFn: ({ pageParam }) => fetchArchivePage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage: readonly unknown[], pages) =>
      lastPage.length < ARCHIVE_PAGE_SIZE ? undefined : pages.length,
    select: readArchive,
    enabled: userId !== null && isOpen,
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
 *
 * Returned to `onSettled`, the tasks' read keeps the move pending until it
 * lands: the buttons stay busy until the screen shows what came of the move,
 * not just until the server said yes. A read that fails ends the wait all the
 * same (`invalidateQueries` does not throw), and the screen says so. His own
 * jobs refresh beside it, not waited for.
 */
function refreshAfterMove(queryClient: QueryClient): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  return queryClient.invalidateQueries({ queryKey: problemKeys.all });
}

/**
 * The head technician's moves are dispatch, not field reports (brief, tech-plan
 * §3.3): online only, never paused on disk and never replayed — a hand-out
 * sent hours later, after a restart, would overrule what the office decided
 * since. One attempt; a failure is said on the screen, nothing changes on the
 * phone until the server is read again.
 */
const DISPATCH = { mutationKey: boardKeys.dispatch, networkMode: 'always', retry: false } as const;

export interface DispatchInFlight {
  /** A move of his is under way — on this screen, or on one he left and came back to. */
  isMoving: boolean;
  /**
   * The same, read from the cache at the moment of asking: a second tap in
   * the same frame as the first, before the screen has redrawn, finds it.
   */
  isMovingNow: () => boolean;
}

/**
 * Whether «Назначить» or «Снять» is under way. Read from the mutation cache,
 * not from the screen's own hooks: a screen opened again while a move is
 * still pending has fresh hooks that know nothing of it, and must not offer a
 * second one.
 */
export function useDispatchInFlight(): DispatchInFlight {
  const queryClient = useQueryClient();
  const pending = useIsMutating({ mutationKey: boardKeys.dispatch });

  return useMemo(
    () => ({
      isMoving: pending > 0,
      isMovingNow: () => queryClient.isMutating({ mutationKey: boardKeys.dispatch }) > 0,
    }),
    [pending, queryClient],
  );
}

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
