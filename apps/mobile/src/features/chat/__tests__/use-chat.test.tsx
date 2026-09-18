import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { fetchUnreadThreads } from '../api';
import { useUnreadSubjects } from '../use-chat';

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

const TASK = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';

function wrapper({ children }: { children: ReactNode }) {
  // gcTime 0: a collection timer left behind holds the jest worker open.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

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
