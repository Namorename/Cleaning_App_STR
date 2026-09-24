import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
  type DehydratedState,
} from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { fetchMyTasks, fetchTask } from '../api';
import { taskKeys, useMyTasks, useTask } from '../use-tasks';

jest.mock('../api', () => ({
  fetchMyTasks: jest.fn(),
  fetchFreeTasks: jest.fn(),
  fetchTask: jest.fn(),
  claimTask: jest.fn(),
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

/**
 * A client whose tasks came back from disk the way the app restores them:
 * dehydrated, written as JSON, read back and hydrated. zod never sees them.
 * gcTime Infinity schedules no collection timer, so nothing holds the worker.
 */
function restoredFromDisk(key: readonly unknown[], data: unknown): QueryClient {
  const options = { defaultOptions: { queries: { retry: false, gcTime: Infinity } } };
  const before = new QueryClient(options);
  before.setQueryData(key, data);
  // The persister's own round trip: whatever shape went in comes back untyped.
  const onDisk = JSON.parse(JSON.stringify(dehydrate(before))) as DehydratedState;
  before.clear();

  const client = new QueryClient(options);
  hydrate(client, onDisk);
  return client;
}

function withClient(client: QueryClient) {
  return function ClientWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

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
