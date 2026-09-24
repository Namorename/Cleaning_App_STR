import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { fetchMessages, fetchUnreadThreads } from '../api';
import { chatKeys } from '../keys';
import { useMessages, useUnreadSubjects } from '../use-chat';

jest.mock('../api', () => ({
  fetchUnreadThreads: jest.fn(),
  fetchMessages: jest.fn(),
  markThreadRead: jest.fn(),
  openThread: jest.fn(),
  sendMessage: jest.fn(),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '22222222-2222-4222-8222-222222222222' }),
}));

const fetchUnread = fetchUnreadThreads as jest.MockedFunction<typeof fetchUnreadThreads>;
const fetchThreadMessages = fetchMessages as jest.MockedFunction<typeof fetchMessages>;

const TASK = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const THREAD = '44444444-4444-4444-8444-444444444444';

function wrapper({ children }: { children: ReactNode }) {
  // gcTime 0: a collection timer left behind holds the jest worker open.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** This thread's messages as they came back from disk (`restoredFromDisk`). */
function restoredThread(rows: unknown): QueryClient {
  return restoredFromDisk(chatKeys.messages(THREAD), rows);
}

/** A message as the build before layer 5 read it: no `task_media` at all. */
const MESSAGE_WITHOUT_PHOTOS_KEY = {
  id: '55555555-5555-4555-8555-555555555555',
  thread_id: THREAD,
  author_id: '66666666-6666-4666-8666-666666666666',
  author_name: 'Olga Manager',
  author_role: 'manager',
  body: '',
  media_expected: 1,
  created_at: '2026-09-24T11:00:19+00:00',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('marks the subjects the server names and no other', async () => {
  fetchUnread.mockResolvedValue([
    {
      thread_id: '44444444-4444-4444-8444-444444444444',
      kind: 'task',
      task_id: TASK,
      problem_id: null,
      last_message_at: '2026-09-18T10:07:00+00:00',
    },
  ]);

  const { result } = await renderHook(() => useUnreadSubjects([TASK, OTHER], []), { wrapper });

  // Empty until the answer: a mark that is not there yet beats a wrong one.
  expect(result.current.tasks.size).toBe(0);
  await waitFor(() => expect(result.current.tasks.has(TASK)).toBe(true));
  expect(result.current.tasks.has(OTHER)).toBe(false);
  expect(fetchUnread).toHaveBeenCalledWith({ taskIds: [TASK, OTHER], problemIds: [] });
});

test('does not ask at all for an empty screen', async () => {
  const { result } = await renderHook(() => useUnreadSubjects([], []), { wrapper });

  expect(result.current.tasks.size).toBe(0);
  expect(fetchUnread).not.toHaveBeenCalled();
});

// The OTA of 2026-09-24 added photos to the message select without changing
// the cache buster. A thread opened before it came back from disk without
// `task_media`, and the chat screen closed the app on `row.uploaded_at`.
test('a thread saved to disk by an older build reads as one with no photos', async () => {
  // Arrange: the refresh never answers, so the screen draws what the disk gave.
  const client = restoredThread([MESSAGE_WITHOUT_PHOTOS_KEY]);
  fetchThreadMessages.mockReturnValue(new Promise(() => {}));

  // Act
  const { result } = await renderHook(() => useMessages(THREAD, false), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current.data?.[0].task_media).toEqual([]);
  expect(result.current.isError).toBe(false);
});

test('a cached row no build can read is a short query error, and a good answer clears it', async () => {
  // Arrange: offline, so the fetch settles and nothing is left in flight.
  const client = restoredThread([{ id: 'not-a-message' }]);
  fetchThreadMessages.mockRejectedValue(new Error('offline'));

  // Act
  const { result } = await renderHook(() => useMessages(THREAD, false), {
    wrapper: withClient(client),
  });
  await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

  // Assert: an error the screen can show in a line, and no rows to draw.
  expect(result.current.isError).toBe(true);
  expect(result.current.data).toBeUndefined();
  expect(result.current.error?.message).toMatch(/^Cached chat messages unreadable at 0\./);
  expect(result.current.error?.message.length).toBeLessThan(200);

  // Act: signal comes back.
  fetchThreadMessages.mockResolvedValue([{ ...MESSAGE_WITHOUT_PHOTOS_KEY, task_media: [] }]);
  await result.current.refetch();

  // Assert
  await waitFor(() => expect(result.current.isError).toBe(false));
  expect(result.current.data).toHaveLength(1);
});
