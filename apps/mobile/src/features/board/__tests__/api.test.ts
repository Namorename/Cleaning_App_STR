import {
  HEAD_TECH,
  PROBLEM_ID,
  REPAIR_ID,
  STAFF,
  TECH_IVAN,
  boardProblem,
} from '@/testing/board-fixtures';

import {
  assignProblem,
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
const mockOrder = jest.fn();
const mockEq = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => ({
      select: (columns: string) => {
        mockSelect(table, columns);
        return {
          order: (...args: unknown[]) => mockOrder(...args),
          eq: (...args: unknown[]) => mockEq(...args),
        };
      },
    }),
  },
}));

const refusal = Object.assign(new Error('Repair changed while the screen was open'), {
  hint: 'serverErrors.taskChangedMeanwhile',
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the board', () => {
  test('reads every task newest first, with its repairs and the house', async () => {
    mockOrder.mockResolvedValue({ data: [boardProblem()], error: null });

    const rows = await fetchBoardProblems();

    const [table, columns] = mockSelect.mock.calls[0] as [string, string];
    expect(table).toBe('problems');
    expect(columns).toContain('archived_at');
    expect(columns).toContain('parent:parent_id(name)');
    expect(columns).toContain(
      'fix_tasks:tasks!tasks_problem_id_fkey(id, type, assignee_id, status, scheduled_date, time_from, time_to)',
    );
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(rows[0].id).toBe(PROBLEM_ID);
  });

  test('one task, for its own screen; none when it is not there', async () => {
    mockEq.mockResolvedValue({ data: [], error: null });

    await expect(fetchBoardProblem(PROBLEM_ID)).resolves.toBeNull();
    expect(mockEq).toHaveBeenCalledWith('id', PROBLEM_ID);
  });

  test('a failed read is thrown as it came', async () => {
    mockOrder.mockResolvedValue({ data: null, error: refusal });

    await expect(fetchBoardProblems()).rejects.toBe(refusal);
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
