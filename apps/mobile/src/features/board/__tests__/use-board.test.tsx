import { QueryClient, onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

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
  fetchBoardProblem,
  fetchBoardProblems,
  fetchStaffDirectory,
  unassignProblem,
} from '../api';
import { boardKeys } from '../keys';
import {
  useAssignProblem,
  useBoardProblem,
  useBoardProblems,
  useStaffDirectory,
  useUnassignProblem,
} from '../use-board';

jest.mock('../api', () => ({
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
});

describe('read through the schema on the way out', () => {
  test('a board saved in an older shape reads with defaults', async () => {
    const client = restoredFromDisk(boardKeys.list(HEAD_TECH), SAVED_BOARD);

    const { result } = await renderHook(() => useBoardProblems(), { wrapper: withClient(client) });

    const [row] = result.current.data ?? [];
    expect(row.archived_at).toBeNull();
    expect(row.property).toEqual({ name: '1 - 2109', hostaway_unit_id: null, parent: null });
    expect(row.fix_tasks[0].scheduled_date).toBeNull();
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

describe('the moves are dispatch, not field reports', () => {
  function freshClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { gcTime: Infinity },
      },
    });
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
