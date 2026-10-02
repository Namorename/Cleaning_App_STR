import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { acceptTask, fetchMyTasks, fetchTask } from '../api';
import { taskKeys, useAcceptTask, useMyTasks, useTask } from '../use-tasks';

jest.mock('../api', () => ({
  fetchMyTasks: jest.fn(),
  fetchFreeTasks: jest.fn(),
  fetchTask: jest.fn(),
  claimTask: jest.fn(),
  acceptTask: jest.fn(),
  startTask: jest.fn(),
  finishTask: jest.fn(),
}));

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

/** A task as the build before the note read it: no `notes` key at all. */
const TASK_WITHOUT_NOTE = {
  id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
  status: 'assigned',
  priority: 0,
  scheduled_date: '2026-11-10',
  due_at: null,
  assignee_id: ME,
  property_id: 412432,
  property: {
    name: 'CZ - Nadrazni Apt 6',
    address: 'Nádražní 6',
    hostaway_unit_id: null,
    effective_cleaner_notes: null,
    parent: null,
  },
  time_from: '10:00:00',
  time_to: '15:00:00',
  guests_count: null,
  started_at: null,
  completed_at: null,
  is_parallel: false,
  type: 'cleaning',
  problem: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  // The refresh never answers, so the screen draws what the disk gave.
  (fetchMyTasks as jest.Mock).mockReturnValue(new Promise(() => {}));
  (fetchTask as jest.Mock).mockReturnValue(new Promise(() => {}));
});

test('her list saved by an older build reads with no note rather than an undefined one', async () => {
  // Arrange
  const client = restoredFromDisk(taskKeys.mine(ME), [TASK_WITHOUT_NOTE]);

  // Act
  const { result } = await renderHook(() => useMyTasks(), { wrapper: withClient(client) });

  // Assert
  expect(result.current.data?.[0].notes).toBeNull();
});

test('a task that is no longer hers reads as none, not as an unreadable cache', async () => {
  // Arrange: nothing cached, and the server says there is no such task for her.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  (fetchTask as jest.Mock).mockResolvedValue(null);

  // Act
  const { result } = await renderHook(() => useTask('9d2ff806-4bea-4aa5-be3c-1b07a629dbee'), {
    wrapper: withClient(client),
  });
  await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

  // Assert
  expect(result.current.isError).toBe(false);
  expect(result.current.data).toBeNull();
});

test('a task opened from that list is read the same way', async () => {
  // Arrange: the task screen starts from the list's copy of the row.
  const client = restoredFromDisk(taskKeys.mine(ME), [TASK_WITHOUT_NOTE]);

  // Act
  const { result } = await renderHook(() => useTask(TASK_WITHOUT_NOTE.id), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current.data?.notes).toBeNull();
});

test('an accepted cleaning reads as accepted at once, in her list and on its screen', async () => {
  // Arrange: her list as the server last sent it, and the accept that answers
  // with the row moved on. Without writing the row into the caches, the list
  // would show "Принять" again until its refetch landed — on weak signal, for
  // seconds, inviting a second tap that looks like the first did nothing.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const assigned = { ...TASK_WITHOUT_NOTE, notes: null, title: null, title_i18n: {} };
  client.setQueryData(taskKeys.mine(ME), [assigned]);
  client.setQueryData(taskKeys.one(assigned.id), assigned);
  (acceptTask as jest.Mock).mockResolvedValue({ ...assigned, status: 'accepted' });
  const { result } = await renderHook(() => useAcceptTask(), { wrapper: withClient(client) });

  // Act
  await act(async () => {
    await result.current.mutateAsync({
      taskId: assigned.id,
      scheduledDate: assigned.scheduled_date,
      propertyId: assigned.property_id,
    });
  });

  // Assert
  expect(client.getQueryData<{ status: string }[]>(taskKeys.mine(ME))?.[0].status).toBe('accepted');
  expect(client.getQueryData<{ status: string }>(taskKeys.one(assigned.id))?.status).toBe(
    'accepted',
  );
});
