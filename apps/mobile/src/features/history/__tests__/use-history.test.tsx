import { renderHook } from '@testing-library/react-native';

import { HEAD_TECH, PROBLEM_ID, REPAIR_ID } from '@/testing/board-fixtures';
import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { fetchProblemEvents } from '../api';
import { historyKeys } from '../keys';
import { useProblemEvents } from '../use-history';

jest.mock('../api', () => ({ fetchProblemEvents: jest.fn() }));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  // The refresh never answers, so the hook reads what the disk gave.
  jest.mocked(fetchProblemEvents).mockReturnValue(new Promise(() => {}));
});

test('a journal saved in an older shape reads with defaults; odd parameters as none', async () => {
  // Arrange: no task, no actor, parameters that are not an object, or none.
  const client = restoredFromDisk(historyKeys.events(HEAD_TECH, PROBLEM_ID), [
    {
      id: 7,
      problem_id: PROBLEM_ID,
      kind: 'reported',
      created_at: '2026-10-05T08:00:00+00:00',
      params: 'odd',
    },
    {
      id: 8,
      problem_id: PROBLEM_ID,
      task_id: REPAIR_ID,
      kind: 'accepted',
      actor_id: HEAD_TECH,
      created_at: '2026-10-05T09:00:00+00:00',
    },
  ]);

  // Act
  const { result } = await renderHook(() => useProblemEvents(PROBLEM_ID), {
    wrapper: withClient(client),
  });

  // Assert
  const [first, second] = result.current.data ?? [];
  expect(first).toMatchObject({ task_id: null, actor_id: null, params: {} });
  expect(second).toMatchObject({ task_id: REPAIR_ID, actor_id: HEAD_TECH, params: {} });
});

test('the journal is kept under the tasks, so a move of the head technician refreshes it', () => {
  expect(historyKeys.events(HEAD_TECH, PROBLEM_ID).slice(0, 1)).toEqual(['problems']);
});
