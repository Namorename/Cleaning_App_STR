import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  BOARD_CLOSED_LIMIT,
  BOARD_OPEN_LIMIT,
  assignProblem,
  fetchArchivePage,
  fetchBoardProblem,
  fetchBoardProblems,
  fetchStaffDirectory,
  unassignProblem,
} from '../api';
import { isClosed, type BoardProblem } from '../schema';

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

const OPEN_ID = 'd1e2f3a4-1111-4111-8111-d1e2f3a40101';
const CLOSED_ID = 'd1e2f3a4-1111-4111-8111-d1e2f3a40102';

const refusal = Object.assign(new Error('Repair changed while the screen was open'), {
  hint: 'serverErrors.taskChangedMeanwhile',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockChain.length = 0;
});

describe('the board', () => {
  test('reads every task newest first, with its repairs and the house', async () => {
    mockAnswer
      .mockReturnValueOnce({ data: [boardProblem()], error: null })
      .mockReturnValueOnce({ data: [], error: null });

    const { problems: rows } = await fetchBoardProblems();

    for (const [table, columns] of mockSelect.mock.calls as [string, string][]) {
      expect(table).toBe('problems');
      expect(columns).toContain('archived_at');
      expect(columns).toContain('parent:parent_id(name)');
      expect(columns).toContain(
        'fix_tasks:tasks!tasks_problem_id_fkey(id, type, assignee_id, status, scheduled_date, time_from, time_to)',
      );
    }
    expect(chained('order')).toEqual([
      ['created_at', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
    expect(rows[0].id).toBe(PROBLEM_ID);
  });

  // A company's tasks only grow: the board reads what is live and the last
  // month's closed work, and the archive only when it is asked for, a page at
  // a time (brief, item 6). Two reads: a limit on one read of both would drop
  // a task still open from five weeks ago before last week's closed ones (the
  // verification review of f3217a7..c466bf5, item 3).
  test('reads no archive: what is not closed, and apart, what was closed in the last thirty days', async () => {
    mockAnswer.mockReturnValue({ data: [], error: null });

    await fetchBoardProblems(new Date(2026, 9, 9, 12, 0));

    expect(mockSelect).toHaveBeenCalledTimes(2);
    expect(chained('is')).toEqual([
      ['archived_at', null],
      ['archived_at', null],
    ]);
    expect(chained('not')).toEqual([['status', 'in', '(resolved,cancelled)']]);
    expect(chained('in')).toEqual([['status', ['resolved', 'cancelled']]]);
    expect(chained('gte')).toEqual([['updated_at', '2026-09-09']]);
    expect(chained('or')).toEqual([]);
  });

  test('reads the open ones to their limit and the closed ones to theirs, one more of each', async () => {
    mockAnswer.mockReturnValue({ data: [], error: null });

    await fetchBoardProblems();

    expect(BOARD_OPEN_LIMIT).toBe(999);
    expect(BOARD_CLOSED_LIMIT).toBe(200);
    expect(chained('limit')).toEqual([[BOARD_OPEN_LIMIT + 1], [BOARD_CLOSED_LIMIT + 1]]);
  });

  // The server returns at most `max_rows` rows a read, however many are asked
  // for: an open limit at it would never show the one more that tells a cut.
  test('the one more open task asked for fits within what the server returns', () => {
    const config = readFileSync(join(__dirname, '../../../../../../supabase/config.toml'), 'utf8');
    const maxRows = Number(/^max_rows\s*=\s*(\d+)/m.exec(config)?.[1]);

    expect(maxRows).toBeGreaterThan(0);
    expect(BOARD_OPEN_LIMIT + 1).toBeLessThanOrEqual(maxRows);
  });

  test('hands back the open ones first, then the closed ones', async () => {
    const OPEN_OLD = boardProblem({ id: OPEN_ID, created_at: '2026-08-30T08:00:00+00:00' });
    const CLOSED_NEW = boardProblem({ id: CLOSED_ID, status: 'resolved' });
    mockAnswer
      .mockReturnValueOnce({ data: [OPEN_OLD], error: null })
      .mockReturnValueOnce({ data: [CLOSED_NEW], error: null });

    const { problems: rows } = await fetchBoardProblems();

    expect(rows.map((row) => row.id)).toEqual([OPEN_ID, CLOSED_ID]);
  });

  // The two reads go out together: a task closed between them is in both,
  // open in one and closed in the other (the verification review of
  // c466bf5..bc7dcc9, item 7). Shown once — open, as work until the next
  // refresh says otherwise.
  test('a task closed between the two reads is shown once, as the open read has it', async () => {
    const CLOSING = 'd1e2f3a4-1111-4111-8111-d1e2f3a40103';
    mockAnswer
      .mockReturnValueOnce({
        data: [boardProblem({ id: CLOSING }), boardProblem({ id: OPEN_ID })],
        error: null,
      })
      .mockReturnValueOnce({
        data: [
          boardProblem({ id: CLOSING, status: 'resolved' }),
          boardProblem({ id: CLOSED_ID, status: 'resolved' }),
        ],
        error: null,
      });

    const { problems: rows } = await fetchBoardProblems();

    expect(rows.map((row) => [row.id, row.status])).toEqual([
      [CLOSING, 'open'],
      [OPEN_ID, 'open'],
      [CLOSED_ID, 'resolved'],
    ]);
  });

  /** `count` tasks of one status, numbered from `from`. */
  function numbered(count: number, status: BoardProblem['status'], from = 0): BoardProblem[] {
    return Array.from({ length: count }, (_, index) =>
      boardProblem({
        id: `d1e2f3a4-3333-4333-8333-${String(from + index).padStart(12, '0')}`,
        status,
      }),
    );
  }

  // Each read asks for one more than the board shows; the one more says the
  // part was cut. Said by what each read answered.
  test.each([
    ['one more open', BOARD_OPEN_LIMIT + 1, BOARD_CLOSED_LIMIT, true, false],
    ['one more closed', BOARD_OPEN_LIMIT, BOARD_CLOSED_LIMIT + 1, false, true],
    ['each exactly to its limit', BOARD_OPEN_LIMIT, BOARD_CLOSED_LIMIT, false, false],
  ])('%s: each read says whether it was cut', async (_, open, closed, isOpenCut, isClosedCut) => {
    mockAnswer
      .mockReturnValueOnce({ data: numbered(open, 'open'), error: null })
      .mockReturnValueOnce({ data: numbered(closed, 'resolved', 5_000), error: null });

    const read = await fetchBoardProblems();

    expect(read.isOpenCut).toBe(isOpenCut);
    expect(read.isClosedCut).toBe(isClosedCut);
  });

  // The task closed between the reads is in both, and handed back once: the
  // closed part went from its limit and one more to its limit, and the board
  // said nothing of the cut (night journal, review of bc7dcc9..dab5237). The
  // cut is what the read answered, before anything is handed back once.
  test('a task closed between the two reads does not hide that the closed read was cut', async () => {
    const CLOSING = 'd1e2f3a4-1111-4111-8111-d1e2f3a40103';
    mockAnswer
      .mockReturnValueOnce({ data: [boardProblem({ id: CLOSING })], error: null })
      .mockReturnValueOnce({
        data: [
          boardProblem({ id: CLOSING, status: 'resolved' }),
          ...numbered(BOARD_CLOSED_LIMIT, 'resolved'),
        ],
        error: null,
      });

    const read = await fetchBoardProblems();

    expect(read.problems.filter((problem) => problem.id === CLOSING)).toHaveLength(1);
    expect(read.problems.filter(isClosed)).toHaveLength(BOARD_CLOSED_LIMIT);
    expect(read.isClosedCut).toBe(true);
    expect(read.isOpenCut).toBe(false);
  });

  test('a read of either part that fails fails the board', async () => {
    mockAnswer
      .mockReturnValueOnce({ data: [], error: null })
      .mockReturnValueOnce({ data: null, error: new Error('permission denied') });

    await expect(fetchBoardProblems()).rejects.toThrow('permission denied');
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
