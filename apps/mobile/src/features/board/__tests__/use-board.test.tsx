import {
  QueryClient,
  dehydrate,
  hydrate,
  onlineManager,
  type DehydratedState,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { createAppQueryClient } from '@/lib/query-client';
import { readCached } from '@/lib/read-cached';

import {
  HEAD_TECH,
  PROBLEM_ID,
  REPAIR_ID,
  TECH_IVAN,
  boardProblem,
} from '@/testing/board-fixtures';
import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import {
  assignProblem,
  fetchArchivePage,
  fetchBoardProblem,
  fetchBoardProblems,
  fetchStaffDirectory,
  unassignProblem,
} from '../api';
import { boardKeys } from '../keys';
import { boardProblemListSchema, cutBoard, type BoardProblem, type BoardRead } from '../schema';
import {
  useAssignProblem,
  useBoardArchive,
  useBoardCut,
  useBoardProblem,
  useBoardProblems,
  useStaffDirectory,
  useUnassignProblem,
} from '../use-board';

jest.mock('../api', () => ({
  ARCHIVE_PAGE_SIZE: 50,
  fetchArchivePage: jest.fn(),
  fetchBoardProblems: jest.fn(),
  fetchBoardProblem: jest.fn(),
  fetchStaffDirectory: jest.fn(),
  assignProblem: jest.fn(),
  unassignProblem: jest.fn(),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

/** A board as the first build that kept one saved it — before any key added since. */
const SAVED_BOARD = [
  {
    id: PROBLEM_ID,
    property_id: 412432,
    title: 'Кран течёт',
    priority: 'normal',
    status: 'assigned',
    created_at: '2026-10-05T08:00:00+00:00',
    property: { name: '1 - 2109' },
    fix_tasks: [{ id: REPAIR_ID, assignee_id: TECH_IVAN, status: 'assigned' }],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  // The refresh never answers, so the hooks read what the disk gave.
  jest.mocked(fetchBoardProblems).mockReturnValue(new Promise(() => {}));
  jest.mocked(fetchBoardProblem).mockReturnValue(new Promise(() => {}));
  jest.mocked(fetchStaffDirectory).mockReturnValue(new Promise(() => {}));
  jest.mocked(fetchArchivePage).mockReturnValue(new Promise(() => {}));
});

describe('read through the schema on the way out', () => {
  test('a board saved in an older shape reads with defaults, and nothing said cut', async () => {
    const client = restoredFromDisk(boardKeys.list(HEAD_TECH), SAVED_BOARD);

    const { result } = await renderHook(() => ({ board: useBoardProblems(), cut: useBoardCut() }), {
      wrapper: withClient(client),
    });

    const [row] = result.current.board.data ?? [];
    expect(row.archived_at).toBeNull();
    expect(row.property).toEqual({ name: '1 - 2109', hostaway_unit_id: null, parent: null });
    expect(row.fix_tasks[0].scheduled_date).toBeNull();
    expect(result.current.cut).toEqual({ isOpenCut: false, isClosedCut: false });
  });

  test('a task opened from the board starts from the board’s copy', async () => {
    const client = restoredFromDisk(boardKeys.list(HEAD_TECH), SAVED_BOARD);

    const { result } = await renderHook(() => useBoardProblem(PROBLEM_ID), {
      wrapper: withClient(client),
    });

    expect(result.current.data?.fix_tasks[0].assignee_id).toBe(TECH_IVAN);
  });

  test('a directory that cannot be read off the disk says where, not what zod thinks', async () => {
    const client = restoredFromDisk(boardKeys.staff(HEAD_TECH), [{ id: 'nobody' }]);

    const { result } = await renderHook(() => useStaffDirectory(), {
      wrapper: withClient(client),
    });

    await waitFor(() => expect(result.current.error?.message).toMatch(/^Cached staff unreadable/));
  });
});

/**
 * What this build keeps on disk under a key the installed build reads (1.2.0
 * at dab5237) is in that build's shape: rolled back, the older bundle reads
 * the board as its rows (the review of cb747a5..7553530, MEDIUM). What the
 * reads said of the cut is kept under a key of its own, and comes back with
 * the board after a restart.
 */
describe('the board on disk', () => {
  const OPEN = boardProblem({ id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001', status: 'open' });
  const closed = (index: number) =>
    boardProblem({
      id: `d1e2f3a4-2222-4222-8222-${String(index).padStart(12, '0')}`,
      status: 'resolved',
    });
  /** Small limits, so the closed part below is exactly at its limit. */
  const LIMITS = { open: 5, closed: 2 };
  /**
   * A task closed between the two reads, handed back once (api.ts): the
   * closed part is at its limit, and only its read knows it was cut.
   */
  const DEDUPLICATED: BoardRead = {
    problems: [OPEN, closed(1), closed(2)],
    isOpenCut: false,
    isClosedCut: true,
  };

  function client(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  }

  /** The app closed and started again: the cache through the disk, as the persister keeps it. */
  function restarted(before: QueryClient): QueryClient {
    const onDisk = JSON.parse(JSON.stringify(dehydrate(before))) as DehydratedState;
    const after = client();
    hydrate(after, onDisk);
    return after;
  }

  /** The board as its screen cuts it (board-screen.tsx). */
  function useCutBoard() {
    const board = useBoardProblems();
    const cut = useBoardCut();
    return board.data === undefined
      ? undefined
      : cutBoard({ problems: board.data, ...cut }, LIMITS);
  }

  test('the board under its key is its rows alone, as the installed build reads it', async () => {
    // Arrange
    jest.mocked(fetchBoardProblems).mockResolvedValue(DEDUPLICATED);
    const live = client();
    const { result } = await renderHook(() => useBoardProblems(), { wrapper: withClient(live) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Act: rolled back, the older bundle starts from this disk.
    const held = restarted(live).getQueryData<BoardProblem[]>(boardKeys.list(HEAD_TECH));

    // Assert: its `select` and its task screen's copy (dab5237's use-board.ts).
    expect(readCached(boardProblemListSchema, held, 'board')).toHaveLength(3);
    expect(held?.find((problem) => problem.id === OPEN.id)?.title).toBe(OPEN.title);
  });

  test('a closed read cut, though what came back is at its limit: said so, and after a restart', async () => {
    // Arrange
    jest.mocked(fetchBoardProblems).mockResolvedValue(DEDUPLICATED);
    const live = client();

    // Act
    const first = await renderHook(useCutBoard, { wrapper: withClient(live) });
    await waitFor(() => expect(first.result.current).toBeDefined());

    // Assert
    expect(first.result.current).toMatchObject({ isOpenCut: false, isClosedCut: true });

    // Act: a restart, its refresh not answered yet.
    jest.mocked(fetchBoardProblems).mockReturnValue(new Promise(() => {}));
    const second = await renderHook(useCutBoard, { wrapper: withClient(restarted(live)) });

    // Assert
    expect(second.result.current).toMatchObject({ isOpenCut: false, isClosedCut: true });
    expect(second.result.current?.problems).toHaveLength(3);
  });
});

/**
 * A refresh cancels the read under way, but its request runs on and may answer
 * after the newer one (the review of 7553530..8a58d77, LOW): the cut is said
 * only by the read whose rows the board keeps.
 */
describe('the cut, said by the read the board keeps', () => {
  const OPEN = boardProblem({ id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001', status: 'open' });
  const CUT: BoardRead = { problems: [OPEN], isOpenCut: true, isClosedCut: true };
  const WHOLE: BoardRead = { problems: [OPEN], isOpenCut: false, isClosedCut: false };
  const NOTHING_CUT = { isOpenCut: false, isClosedCut: false };

  function client(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  }

  /** A read that answers only when told; told, it is let finish whatever it does then. */
  function heldRead(): { read: Promise<BoardRead>; answer: (read: BoardRead) => Promise<void> } {
    let resolve: (read: BoardRead) => void = () => undefined;
    const read = new Promise<BoardRead>((settle) => {
      resolve = settle;
    });
    const answer = async (answered: BoardRead): Promise<void> => {
      resolve(answered);
      await read;
      await new Promise((settle) => setTimeout(settle, 0));
    };
    return { read, answer };
  }

  /** The board on screen, its first read answered with `first`, and a refresh under way. */
  async function boardRefreshing(first: BoardRead) {
    const live = client();
    const older = heldRead();
    jest.mocked(fetchBoardProblems).mockResolvedValueOnce(first).mockReturnValueOnce(older.read);
    const { result } = await renderHook(() => ({ board: useBoardProblems(), cut: useBoardCut() }), {
      wrapper: withClient(live),
    });
    await waitFor(() => expect(result.current.board.isSuccess).toBe(true));
    await act(async () => {
      void result.current.board.refetch();
    });
    await waitFor(() => expect(fetchBoardProblems).toHaveBeenCalledTimes(2));
    return { live, result, answerOlder: older.answer };
  }

  test('an older read that answers after the newer one leaves the newer one’s cut', async () => {
    // Arrange: a board read once, cut; a refresh under way.
    const { live, result, answerOlder } = await boardRefreshing(CUT);
    jest.mocked(fetchBoardProblems).mockResolvedValueOnce(WHOLE);

    // Act: a second pull cancels the first and is answered; then the first answers.
    await act(async () => {
      await result.current.board.refetch();
    });
    await waitFor(() => expect(result.current.cut).toEqual(NOTHING_CUT));
    await act(() => answerOlder(CUT));

    // Assert
    expect(live.getQueryData(boardKeys.cut(HEAD_TECH))).toEqual(NOTHING_CUT);
  });

  test('a newer read that fails leaves the cut as it was, the older one’s answer unheard', async () => {
    // Arrange: a board read once, whole; a refresh under way.
    const { live, result, answerOlder } = await boardRefreshing(WHOLE);
    jest.mocked(fetchBoardProblems).mockRejectedValueOnce(new TypeError('Network request failed'));

    // Act: a second pull cancels the first and fails; then the first answers.
    await act(async () => {
      await result.current.board.refetch();
    });
    await waitFor(() => expect(result.current.board.isError).toBe(true));
    await act(() => answerOlder(CUT));

    // Assert
    expect(live.getQueryData(boardKeys.cut(HEAD_TECH))).toEqual(NOTHING_CUT);
  });
});

describe('the archive, read on demand, a page at a time', () => {
  /** A task put away, its id numbered so a page of them has fifty different ones. */
  function archived(index: number) {
    return boardProblem({
      id: `d1e2f3a4-1111-4111-8111-${String(index).padStart(12, '0')}`,
      archived_at: '2026-10-06T08:00:00+00:00',
    });
  }

  function client(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  }

  test('nothing is read before he opens the archive', async () => {
    await renderHook(() => useBoardArchive(false), { wrapper: withClient(client()) });

    expect(fetchArchivePage).not.toHaveBeenCalled();
  });

  test('a full page offers the next one; a short page is the last', async () => {
    // Arrange
    jest
      .mocked(fetchArchivePage)
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => archived(index)))
      .mockResolvedValueOnce([archived(50), archived(51)]);
    const { result } = await renderHook(() => useBoardArchive(true), {
      wrapper: withClient(client()),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(50));
    expect(result.current.hasNextPage).toBe(true);

    // Act: «Ещё».
    await act(async () => {
      await result.current.fetchNextPage();
    });

    // Assert
    await waitFor(() => expect(result.current.data).toHaveLength(52));
    expect(jest.mocked(fetchArchivePage).mock.calls.map(([page]) => page)).toEqual([0, 1]);
    expect(result.current.hasNextPage).toBe(false);
  });

  test('pages saved in an older shape read with defaults', async () => {
    const saved = {
      pages: [SAVED_BOARD.map((row) => ({ ...row, archived_at: '2026-10-06T08:00:00+00:00' }))],
      pageParams: [0],
    };
    const restored = restoredFromDisk(boardKeys.archive(HEAD_TECH), saved);

    const { result } = await renderHook(() => useBoardArchive(true), {
      wrapper: withClient(restored),
    });

    const [row] = result.current.data ?? [];
    expect(row.property).toEqual({ name: '1 - 2109', hostaway_unit_id: null, parent: null });
    expect(row.fix_tasks[0].scheduled_date).toBeNull();
  });
});

describe('the moves are dispatch, not field reports', () => {
  /**
   * The app's own client: its moves pause without signal and try a refusal
   * again (lib/query-client.ts), so what keeps the dispatch from doing either
   * is its own options. Reads are not retried and never collected.
   */
  function freshClient(): QueryClient {
    const client = createAppQueryClient();
    const defaults = client.getDefaultOptions();
    client.setDefaultOptions({
      ...defaults,
      queries: { ...defaults.queries, retry: false, gcTime: Infinity },
    });
    return client;
  }

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  test('without signal «Назначить» is not queued for later: it is sent now, and fails now', async () => {
    // Arrange
    onlineManager.setOnline(false);
    jest.mocked(assignProblem).mockRejectedValue(new TypeError('Network request failed'));
    const { result } = await renderHook(() => useAssignProblem(), {
      wrapper: withClient(freshClient()),
    });

    // Act
    await act(async () => {
      result.current.mutate({
        problemId: PROBLEM_ID,
        assigneeId: TECH_IVAN,
        scheduledDate: '2026-10-09',
        timeFrom: null,
        timeTo: null,
      });
    });

    // Assert: tried once, never paused, never retried.
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPaused).toBe(false);
    expect(assignProblem).toHaveBeenCalledTimes(1);
  });

  test('a refusal of «Назначить» is not tried again', async () => {
    const refusal = Object.assign(new Error('refused'), { hint: 'serverErrors.repairNeedsTech' });
    jest.mocked(assignProblem).mockRejectedValue(refusal);
    const { result } = await renderHook(() => useAssignProblem(), {
      wrapper: withClient(freshClient()),
    });

    await act(async () => {
      result.current.mutate({
        problemId: PROBLEM_ID,
        assigneeId: TECH_IVAN,
        scheduledDate: '2026-10-09',
        timeFrom: null,
        timeTo: null,
      });
    });

    await waitFor(() => expect(result.current.error).toBe(refusal));
    expect(assignProblem).toHaveBeenCalledTimes(1);
  });

  test('a refusal of «Снять» is not tried again', async () => {
    const refusal = Object.assign(new Error('changed'), {
      hint: 'serverErrors.taskChangedMeanwhile',
    });
    jest.mocked(unassignProblem).mockRejectedValue(refusal);
    const { result } = await renderHook(() => useUnassignProblem(), {
      wrapper: withClient(freshClient()),
    });

    await act(async () => {
      result.current.mutate({ taskId: REPAIR_ID, expectedAssigneeId: TECH_IVAN });
    });

    await waitFor(() => expect(result.current.error).toBe(refusal));
    expect(unassignProblem).toHaveBeenCalledTimes(1);
  });

  test.each(['done', 'refused'] as const)(
    'whatever the answer (%s), the tasks and the jobs are read again',
    async (outcome) => {
      // Arrange
      const client = freshClient();
      client.setQueryData(boardKeys.list(HEAD_TECH), [boardProblem()]);
      client.setQueryData(['tasks', 'mine', HEAD_TECH], []);
      client.setQueryData(['problems', 'one', PROBLEM_ID], null);
      if (outcome === 'done') {
        jest.mocked(unassignProblem).mockResolvedValue(undefined);
      } else {
        jest.mocked(unassignProblem).mockRejectedValue(new Error('changed'));
      }
      const { result } = await renderHook(() => useUnassignProblem(), {
        wrapper: withClient(client),
      });

      // Act
      await act(async () => {
        result.current.mutate({ taskId: REPAIR_ID, expectedAssigneeId: TECH_IVAN });
      });

      // Assert: stale, so the screens showing them fetch again.
      await waitFor(() => expect(result.current.isIdle).toBe(false));
      await waitFor(() => expect(result.current.isPending).toBe(false));
      for (const key of [
        boardKeys.list(HEAD_TECH),
        ['tasks', 'mine', HEAD_TECH],
        ['problems', 'one', PROBLEM_ID],
      ]) {
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      }
    },
  );
});
