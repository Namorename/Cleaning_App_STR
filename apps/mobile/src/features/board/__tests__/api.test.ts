import {
  HEAD_TECH,
  PROBLEM_ID,
  REPAIR_ID,
  STAFF,
  TECH_IVAN,
  boardProblem,
} from '@/testing/board-fixtures';

import {
  ARCHIVE_PAGE_SIZE,
  BOARD_LIVE_LIMIT,
  assignProblem,
  fetchArchivePage,
  fetchBoardProblem,
  fetchBoardProblems,
  fetchStaffDirectory,
  unassignProblem,
} from '../api';

/**
 * The board's reads and the head technician's two moves (docs/tech-plan.md
 * §3.3). The moves are the server's dispatch functions, called by name with
 * exactly the arguments the deployed signatures take.
 */

const mockRpc = jest.fn();
const mockSelect = jest.fn();
/** What the read answers, once its chain of filters is awaited. */
const mockAnswer = jest.fn();
/** Every filter, order and range a read chained, in order: [method, ...arguments]. */
const mockChain: unknown[][] = [];

jest.mock('@/lib/supabase', () => {
  const chain = (): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === 'then') {
            return (onValue: (value: unknown) => unknown, onError: (error: unknown) => unknown) =>
              Promise.resolve(mockAnswer()).then(onValue, onError);
          }
          return (...args: unknown[]) => {
            mockChain.push([method, ...args]);
            return chain();
          };
        },
      },
    );
  return {
    supabase: {
      rpc: (...args: unknown[]) => mockRpc(...args),
      from: (table: string) => ({
        select: (columns: string) => {
          mockSelect(table, columns);
          return chain();
        },
      }),
    },
  };
});

/** The calls of one method, by name, in the order they were chained. */
function chained(method: string): unknown[][] {
  return mockChain.filter(([name]) => name === method).map(([, ...args]) => args);
}

const refusal = Object.assign(new Error('Repair changed while the screen was open'), {
  hint: 'serverErrors.taskChangedMeanwhile',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockChain.length = 0;
});

describe('the board', () => {
  test('reads every task newest first, with its repairs and the house', async () => {
    mockAnswer.mockReturnValue({ data: [boardProblem()], error: null });

    const rows = await fetchBoardProblems();

    const [table, columns] = mockSelect.mock.calls[0] as [string, string];
    expect(table).toBe('problems');
    expect(columns).toContain('archived_at');
    expect(columns).toContain('parent:parent_id(name)');
    expect(columns).toContain(
      'fix_tasks:tasks!tasks_problem_id_fkey(id, type, assignee_id, status, scheduled_date, time_from, time_to)',
    );
    expect(chained('order')).toEqual([['created_at', { ascending: false }]]);
    expect(rows[0].id).toBe(PROBLEM_ID);
  });

  // A company's tasks only grow: the board reads what is live and the last
  // month's closed work, and the archive only when it is asked for, a page at
  // a time (brief, item 6).
  test('reads no archive, and closed tasks only of the last thirty days', async () => {
    mockAnswer.mockReturnValue({ data: [], error: null });

    await fetchBoardProblems(new Date(2026, 9, 9, 12, 0));

    expect(chained('is')).toEqual([['archived_at', null]]);
    expect(chained('or')).toEqual([
      ['status.not.in.(resolved,cancelled),updated_at.gte.2026-09-09'],
    ]);
  });

  // Item 11 of the two whole-branch reviews of phone-1-2-0: what is live only
  // grows with a company that falls behind; the board reads the newest 500.
  test('reads at most the newest five hundred', async () => {
    mockAnswer.mockReturnValue({ data: [], error: null });

    await fetchBoardProblems();

    expect(BOARD_LIVE_LIMIT).toBe(500);
    expect(chained('limit')).toEqual([[BOARD_LIVE_LIMIT]]);
  });

  test('the archive is read a page of fifty at a time, newest first', async () => {
    mockAnswer.mockReturnValue({
      data: [boardProblem({ archived_at: '2026-10-06T08:00:00+00:00' })],
      error: null,
    });

    const rows = await fetchArchivePage(2);

    const [table, columns] = mockSelect.mock.calls[0] as [string, string];
    expect(table).toBe('problems');
    expect(columns).toContain('parent:parent_id(name)');
    expect(ARCHIVE_PAGE_SIZE).toBe(50);
    expect(chained('not')).toEqual([['archived_at', 'is', null]]);
    expect(chained('order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(chained('range')).toEqual([[100, 149]]);
    expect(rows[0].archived_at).toBe('2026-10-06T08:00:00+00:00');
  });

  test('one task, for its own screen; none when it is not there', async () => {
    mockAnswer.mockReturnValue({ data: [], error: null });

    await expect(fetchBoardProblem(PROBLEM_ID)).resolves.toBeNull();
    expect(chained('eq')).toEqual([['id', PROBLEM_ID]]);
  });

  test('a failed read is thrown as it came', async () => {
    mockAnswer.mockReturnValue({ data: null, error: refusal });

    await expect(fetchBoardProblems()).rejects.toBe(refusal);
    await expect(fetchArchivePage(0)).rejects.toBe(refusal);
  });

  test('names come from the directory, not from profiles', async () => {
    mockRpc.mockResolvedValue({ data: STAFF, error: null });

    const staff = await fetchStaffDirectory();

    expect(mockRpc).toHaveBeenCalledWith('staff_directory');
    expect(staff).toEqual(STAFF);
  });
});

describe('the moves', () => {
  test('«Назначить» hands the task to the person for the day, hours left out', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await assignProblem({
      problemId: PROBLEM_ID,
      assigneeId: TECH_IVAN,
      scheduledDate: '2026-10-09',
      timeFrom: null,
      timeTo: null,
    });

    expect(mockRpc).toHaveBeenCalledWith('assign_problem', {
      p_id: PROBLEM_ID,
      p_assignee_id: TECH_IVAN,
      p_scheduled_date: '2026-10-09',
      p_time_from: undefined,
      p_time_to: undefined,
    });
  });

  test('hours the repair already has are sent back as they are', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await assignProblem({
      problemId: PROBLEM_ID,
      assigneeId: HEAD_TECH,
      scheduledDate: '2026-10-10',
      timeFrom: '10:00:00',
      timeTo: '12:00:00',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'assign_problem',
      expect.objectContaining({ p_time_from: '10:00:00', p_time_to: '12:00:00' }),
    );
  });

  test('«Снять» names the person the screen showed', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await unassignProblem({ taskId: REPAIR_ID, expectedAssigneeId: TECH_IVAN });

    expect(mockRpc).toHaveBeenCalledWith('unassign_problem', {
      p_task_id: REPAIR_ID,
      p_expected_assignee: TECH_IVAN,
    });
  });

  test('a refusal comes back with its key, for the screen to translate', async () => {
    mockRpc.mockResolvedValue({ data: null, error: refusal });

    await expect(
      unassignProblem({ taskId: REPAIR_ID, expectedAssigneeId: TECH_IVAN }),
    ).rejects.toBe(refusal);
  });
});
