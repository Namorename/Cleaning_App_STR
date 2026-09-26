import { renderHook } from '@testing-library/react-native';

import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { fetchMyProblems, fetchProblem } from '../api';
import { problemKeys } from '../keys';
import { useMyProblems, useProblem } from '../use-problems';

jest.mock('../api', () => ({
  fetchMyProblems: jest.fn(),
  fetchProblem: jest.fn(),
  reportProblem: jest.fn(),
  updateProblem: jest.fn(),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

/** A report as the build before 6f29db2 read it: the listing's name and nothing else. */
const REPORT_BEFORE_THE_HOUSE = {
  id: 'c8ff0001-0000-4000-8000-000000000001',
  property_id: 412432,
  task_id: null,
  reported_by: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  title: 'Течёт кран',
  description: null,
  priority: 'normal',
  status: 'open',
  resolved_at: null,
  cancelled_at: null,
  cancel_reason: null,
  created_at: '2026-09-16T10:00:00+00:00',
  property: { name: '1 - 2109' },
  fix_tasks: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  // The refresh never answers, so the screen draws what the disk gave.
  (fetchMyProblems as jest.Mock).mockReturnValue(new Promise(() => {}));
  (fetchProblem as jest.Mock).mockReturnValue(new Promise(() => {}));
});

test('her reports saved before the house was asked for read with none, not undefined', async () => {
  // Arrange
  const client = restoredFromDisk(problemKeys.mine(), [REPORT_BEFORE_THE_HOUSE]);

  // Act
  const { result } = await renderHook(() => useMyProblems(), { wrapper: withClient(client) });

  // Assert
  expect(result.current.data?.[0].property).toEqual({
    name: '1 - 2109',
    hostaway_unit_id: null,
    parent: null,
  });
});

test('a report opened from that list is read the same way', async () => {
  // Arrange: the report screen starts from the list's copy of the row.
  const client = restoredFromDisk(problemKeys.mine(), [REPORT_BEFORE_THE_HOUSE]);

  // Act
  const { result } = await renderHook(() => useProblem(REPORT_BEFORE_THE_HOUSE.id), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current.data?.property?.parent).toBeNull();
});
