import { PROBLEM_ID } from '@/testing/board-fixtures';

import { fetchProblemEvents } from '../api';

/**
 * The journal of one task, oldest first — the order the story is told in and
 * the order of its index (problem_id, created_at, id).
 */

const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockOrder = jest.fn();
const mockAnswer = { data: [] as unknown[] | null, error: null as Error | null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: (columns: string) => {
          mockSelect(table, columns);
          return chain;
        },
        eq: (...args: unknown[]) => {
          mockEq(...args);
          return chain;
        },
        order: (...args: unknown[]) => {
          mockOrder(...args);
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(mockAnswer).then(resolve),
      };
      return chain;
    },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAnswer.data = [];
  mockAnswer.error = null;
});

test('reads the task’s events oldest first, ties by id', async () => {
  await fetchProblemEvents(PROBLEM_ID);

  expect(mockSelect).toHaveBeenCalledWith(
    'problem_events',
    'id, problem_id, task_id, kind, actor_id, created_at, params',
  );
  expect(mockEq).toHaveBeenCalledWith('problem_id', PROBLEM_ID);
  expect(mockOrder.mock.calls).toEqual([
    ['created_at', { ascending: true }],
    ['id', { ascending: true }],
  ]);
});

test('a failed read is thrown as it came', async () => {
  const failure = new Error('permission denied for table problem_events');
  mockAnswer.data = null;
  mockAnswer.error = failure;

  await expect(fetchProblemEvents(PROBLEM_ID)).rejects.toBe(failure);
});
