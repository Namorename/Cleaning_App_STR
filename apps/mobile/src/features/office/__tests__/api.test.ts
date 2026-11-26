import { fetchTask } from '@/features/tasks/api';
import { serverErrorText } from '@/lib/server-error';
import { CLEANER_ANNA } from '@/testing/board-fixtures';
import { CLEANER_VERA, TASK_ID, officeTask } from '@/testing/office-fixtures';

import {
  OFFICE_TASK_COLUMNS,
  assignCleaning,
  fetchOfficeTask,
  fetchOfficeTasks,
  restoreCleaning,
} from '../api';
import { runProblemAction, setProblemDue } from '../problem-api';

/**
 * The office's reads and moves, called as the server takes them: the rows of
 * the panel's «Уборки» for a span of days, page by page; save_task and
 * restore_cleaning by name, with their arguments by name — PostgREST matches
 * them so, and a misspelt one is a call to a function that does not exist.
 */

const mockRpc = jest.fn();
const mockSelect = jest.fn();
/** What a read answers, once its chain of filters is awaited. */
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

// The cleaning as it stands now, read again just before an assignment.
jest.mock('@/features/tasks/api', () => ({
  ...jest.requireActual<typeof import('@/features/tasks/api')>('@/features/tasks/api'),
  fetchTask: jest.fn(),
}));

function chained(method: string): unknown[][] {
  return mockChain.filter(([name]) => name === method).map(([, ...args]) => args);
}

/** The arguments as the request's body carries them: an undefined one is no argument. */
function body(call: number): unknown {
  return JSON.parse(JSON.stringify(mockRpc.mock.calls[call][1]));
}

/** `count` rows of a page, each its own cleaning. */
function rows(count: number) {
  return Array.from({ length: count }, (_, index) =>
    officeTask({ id: `3f2a1c4e-5b6d-4e8f-9a0b-${String(index).padStart(12, '0')}` }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockChain.length = 0;
  mockAnswer.mockReturnValue({ data: [officeTask()], error: null });
  mockRpc.mockResolvedValue({ data: { id: TASK_ID }, error: null });
});

describe('fetchOfficeTasks', () => {
  test('reads the panel’s «Уборки» on the days asked: no repairs, every status, to the id', async () => {
    const read = await fetchOfficeTasks({ from: '2026-11-01', to: '2026-12-01' });

    expect(read).toHaveLength(1);
    expect(mockSelect).toHaveBeenCalledWith('tasks', OFFICE_TASK_COLUMNS);
    expect(chained('is')).toEqual([['problem_id', null]]);
    expect(chained('gte')).toEqual([['scheduled_date', '2026-11-01']]);
    expect(chained('lt')).toEqual([['scheduled_date', '2026-12-01']]);
    expect(chained('in')).toEqual([]);
    expect(chained('order').map(([column]) => column)).toEqual(['scheduled_date', 'time_from', 'id']);
    expect(chained('range')).toEqual([[0, 499]]);
  });

  test('asks for the person by name, the cancel’s stamp and who took it off', () => {
    expect(OFFICE_TASK_COLUMNS).toContain('assignee:profiles!tasks_assignee_id_fkey(full_name)');
    expect(OFFICE_TASK_COLUMNS).toContain('cancelled_at, release_kind, offs:task_offs');
    expect(OFFICE_TASK_COLUMNS).toContain('problem:problem_id(');
  });

  test('a full page asks for the next one, and the two come back as one list', async () => {
    mockAnswer
      .mockReturnValueOnce({ data: rows(500), error: null })
      .mockReturnValueOnce({ data: rows(3), error: null });

    const read = await fetchOfficeTasks({ from: '2026-11-01', to: '2026-12-01' });

    expect(read).toHaveLength(503);
    expect(chained('range')).toEqual([
      [0, 499],
      [500, 999],
    ]);
  });

  test('more than two months at once is refused before anything is sent', async () => {
    await expect(fetchOfficeTasks({ from: '2026-11-01', to: '2027-01-03' })).rejects.toThrow(
      RangeError,
    );
    expect(mockSelect).not.toHaveBeenCalled();
  });

  test('a failure of the read is thrown as it came', async () => {
    mockAnswer.mockReturnValue({ data: null, error: new Error('offline') });

    await expect(fetchOfficeTasks({ from: '2026-11-18', to: '2026-11-19' })).rejects.toThrow(
      'offline',
    );
  });
});

describe('fetchOfficeTask', () => {
  test('one job by its id; none is null', async () => {
    expect(await fetchOfficeTask(TASK_ID)).toMatchObject({ id: TASK_ID });
    expect(chained('eq')).toEqual([['id', TASK_ID]]);

    mockAnswer.mockReturnValue({ data: [], error: null });
    expect(await fetchOfficeTask(TASK_ID)).toBeNull();
  });
});

describe('assignCleaning', () => {
  test('rewrites only the person: every other field as the cleaning has it now, the day kept and expected', async () => {
    jest.mocked(fetchTask).mockResolvedValue(
      officeTask({
        assignee_id: CLEANER_ANNA,
        title: 'Генеральная',
        notes: 'Ключ у соседей',
        type: 'midstay',
      }),
    );

    await assignCleaning({ taskId: TASK_ID, assigneeId: CLEANER_VERA, shownDate: '2026-11-18' });

    expect(fetchTask).toHaveBeenCalledWith(TASK_ID);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][0]).toBe('save_task');
    expect(body(0)).toEqual({
      p_id: TASK_ID,
      p_property_id: 412432,
      p_type: 'midstay',
      p_scheduled_date: '2026-11-18',
      p_title: 'Генеральная',
      p_assignee_id: CLEANER_VERA,
      p_time_from: '10:00:00',
      p_time_to: '15:00:00',
      p_notes: 'Ключ у соседей',
      p_allow_duplicate: true,
      p_expected_date: '2026-11-18',
    });
  });

  // An omitted argument leaves a field alone only where the function says so;
  // for the title and the note an empty one is what the row holds.
  test('says nothing of the translations or the priority, and no title or note the row lacks', async () => {
    jest.mocked(fetchTask).mockResolvedValue(officeTask({ time_from: null, time_to: null }));

    await assignCleaning({ taskId: TASK_ID, assigneeId: CLEANER_VERA, shownDate: '2026-11-18' });

    expect(Object.keys(body(0) as object).sort()).toEqual(
      [
        'p_allow_duplicate',
        'p_assignee_id',
        'p_expected_date',
        'p_id',
        'p_property_id',
        'p_scheduled_date',
        'p_type',
      ].sort(),
    );
  });

  test('the day expected is the one the card showed, whatever the row says now', async () => {
    jest.mocked(fetchTask).mockResolvedValue(officeTask({ scheduled_date: '2026-11-20' }));

    await assignCleaning({ taskId: TASK_ID, assigneeId: CLEANER_VERA, shownDate: '2026-11-18' });

    expect(body(0)).toMatchObject({
      p_scheduled_date: '2026-11-18',
      p_expected_date: '2026-11-18',
    });
  });

  test('a cleaning gone from sight is refused in the reader’s words; nothing is sent', async () => {
    jest.mocked(fetchTask).mockResolvedValue(null);

    const failure = await assignCleaning({
      taskId: TASK_ID,
      assigneeId: CLEANER_VERA,
      shownDate: '2026-11-18',
    }).catch((error: unknown) => error);

    expect(serverErrorText(failure).text).toBe('Уборка не найдена');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('the server’s refusal is thrown as it came, for the screen to translate', async () => {
    jest.mocked(fetchTask).mockResolvedValue(officeTask());
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'refused', code: 'P0001', hint: 'serverErrors.taskAssigneeInvalid' },
    });

    const failure = await assignCleaning({
      taskId: TASK_ID,
      assigneeId: CLEANER_VERA,
      shownDate: '2026-11-18',
    }).catch((error: unknown) => error);

    expect(serverErrorText(failure).text).toBe('Исполнитель не работает в этой компании');
  });
});

test('restoreCleaning calls restore_cleaning with the cleaning', async () => {
  await restoreCleaning(TASK_ID);

  expect(mockRpc).toHaveBeenCalledWith('restore_cleaning', { p_task_id: TASK_ID });
});

describe('the manager’s levers on a task', () => {
  const PROBLEM = 'd1e2f3a4-1111-4111-8111-d1e2f3a40001';

  test.each([
    [{ kind: 'resolve', problemId: PROBLEM, completedBy: CLEANER_ANNA }, 'resolve_problem', { p_id: PROBLEM, p_completed_by: CLEANER_ANNA }],
    [{ kind: 'resolve', problemId: PROBLEM, completedBy: null }, 'resolve_problem', { p_id: PROBLEM, p_alone: true }],
    [{ kind: 'cancel', problemId: PROBLEM, reason: 'Дубль' }, 'cancel_problem', { p_id: PROBLEM, p_reason: 'Дубль' }],
    [{ kind: 'cancel', problemId: PROBLEM, reason: null }, 'cancel_problem', { p_id: PROBLEM }],
    [{ kind: 'reopen', problemId: PROBLEM }, 'reopen_problem', { p_id: PROBLEM }],
    [{ kind: 'archive', problemId: PROBLEM }, 'archive_problem', { p_id: PROBLEM }],
    [{ kind: 'unarchive', problemId: PROBLEM }, 'unarchive_problem', { p_id: PROBLEM }],
  ] as const)('%o calls %s with %o', async (action, name, args) => {
    await runProblemAction(action);

    expect(mockRpc.mock.calls[0][0]).toBe(name);
    expect(body(0)).toEqual(args);
  });

  test('a refusal is thrown as it came', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'refused', code: '42501', hint: 'serverErrors.managerOnly' },
    });

    const failure = await runProblemAction({ kind: 'archive', problemId: PROBLEM }).catch(
      (error: unknown) => error,
    );

    expect(serverErrorText(failure).text).toBe('Это действие доступно только менеджеру');
  });
});

// The owner, 2026-11-26: the office plans the day a task is to be done (20261126130000).
describe('the planned day of a task', () => {
  const PROBLEM = 'd1e2f3a4-1111-4111-8111-d1e2f3a40001';

  test('a day goes to set_problem_due_date by name', async () => {
    await setProblemDue({ problemId: PROBLEM, dueOn: '2026-12-04' });

    expect(mockRpc.mock.calls[0][0]).toBe('set_problem_due_date');
    expect(body(0)).toEqual({ p_id: PROBLEM, p_due_on: '2026-12-04' });
  });

  test('clearing it sends null itself: the argument has no default to fall back on', async () => {
    await setProblemDue({ problemId: PROBLEM, dueOn: null });

    expect(body(0)).toEqual({ p_id: PROBLEM, p_due_on: null });
  });

  test('a day out of range is refused in the reader’s words', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'The day of a task is from yesterday to a year ahead, not 2030-01-01',
        code: '23514',
        hint: 'serverErrors.problemDueInvalid',
        details: '{"days": 366}',
      },
    });

    const failure = await setProblemDue({ problemId: PROBLEM, dueOn: '2030-01-01' }).catch(
      (error: unknown) => error,
    );

    expect(serverErrorText(failure).text).toBe(
      'Дата выполнения — от вчерашнего дня до года вперёд',
    );
  });
});
