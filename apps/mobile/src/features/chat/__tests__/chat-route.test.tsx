import { fireEvent, render, screen } from '@testing-library/react-native';

import ChatRoute from '@/app/chat/[subject]/[id]';

import { chatMessageSchema, type ChatMessage } from '../schema';

/**
 * A notification about a message opens the app cold, straight onto the
 * thread. The stored session is read a moment later; until then the screen
 * must not say the chat is unavailable. Once she is known, the route wires the
 * thread's failures: a thread that never opened is an error with a retry, one
 * that only failed to refresh keeps its messages; a failed read is said over
 * the transcript, a failed send by the box.
 */

const ME = '66666666-6666-4666-8666-666666666666';
const THREAD = '33333333-3333-4333-8333-333333333333';

const mockSession = { userId: null as string | null, isLoading: true };

const mockThread: { data: { id: string } | undefined; error: Error | null; refetch: jest.Mock } = {
  data: undefined,
  error: null,
  refetch: jest.fn(),
};
const mockMessages: { data: ChatMessage[] | undefined; error: Error | null } = {
  data: undefined,
  error: null,
};
const mockSend: { mutate: jest.Mock; error: Error | null } = { mutate: jest.fn(), error: null };

jest.mock('@/features/auth/session', () => ({
  useSession: () => mockSession,
}));

jest.mock('expo-router', () => ({
  Redirect: () => null,
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ subject: 'task', id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b' }),
}));

jest.mock('@/features/chat/use-chat', () => ({
  useThread: () => mockThread,
  useMessages: () => mockMessages,
  usePendingMessages: () => [],
  useSendMessage: () => mockSend,
  useMarkThreadRead: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/features/media/use-media', () => {
  const idle = () => ({ mutate: jest.fn(), error: null });
  return {
    useAttachMedia: idle,
    useRemoveMedia: idle,
    useRememberLocalMedia: () => jest.fn(),
    useDiscardLocalMedia: () => jest.fn(),
    useLocalMedia: () => ({ data: {} }),
    useMediaUrls: () => ({ data: {} }),
    useOwnMediaStates: () => new Map(),
  };
});

const transcript = [
  chatMessageSchema.parse({
    id: '44444444-4444-4444-8444-444444444444',
    thread_id: THREAD,
    author_id: '77777777-7777-4777-8777-777777777777',
    author_name: 'Olga Manager',
    author_role: 'manager',
    body: 'Ключи в боксе',
    media_expected: 0,
    created_at: '2026-09-18T10:00:00+00:00',
  }),
];

const REFRESH_FAILED = 'Не удалось обновить, показаны сохранённые сообщения.';

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.userId = null;
  mockSession.isLoading = true;
  mockThread.data = undefined;
  mockThread.error = null;
  mockMessages.data = undefined;
  mockMessages.error = null;
  mockSend.error = null;
});

test('opened before the session is read, it waits instead of saying the chat is unavailable', async () => {
  await render(<ChatRoute />);

  expect(screen.getByText('Загружаем сообщения…')).toBeTruthy();
  expect(screen.queryByText('Этот чат недоступен')).toBeNull();
});

describe('signed in', () => {
  beforeEach(() => {
    mockSession.userId = ME;
    mockSession.isLoading = false;
  });

  test('a thread that never opened is titled, and «Повторить» asks again', async () => {
    // Arrange
    mockThread.error = new Error('Network request failed');

    // Act
    await render(<ChatRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    // Assert
    expect(screen.getByText('Не удалось показать экран. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(mockThread.refetch).toHaveBeenCalledTimes(1);
  });

  test('a thread that only failed to refresh keeps its messages, the failure said above', async () => {
    // Arrange: TanStack keeps the opened thread beside the refetch's error.
    mockThread.data = { id: THREAD };
    mockThread.error = new Error('Network request failed');
    mockMessages.data = transcript;

    // Act
    await render(<ChatRoute />);

    // Assert
    expect(screen.getByText('Ключи в боксе')).toBeTruthy();
    expect(screen.getByLabelText('Написать…')).toBeTruthy();
    expect(screen.getByText(REFRESH_FAILED)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  test('a failed read of the messages is said over the transcript, not by the box', async () => {
    // Arrange
    mockThread.data = { id: THREAD };
    mockMessages.data = transcript;
    mockMessages.error = new Error('Network request failed');

    // Act
    await render(<ChatRoute />);

    // Assert
    expect(screen.getByText('Ключи в боксе')).toBeTruthy();
    expect(screen.getByText(REFRESH_FAILED)).toBeTruthy();
  });

  test('a failed send is said by the box, with no banner over the transcript', async () => {
    // Arrange
    mockThread.data = { id: THREAD };
    mockMessages.data = transcript;
    // As PostgREST hands a refusal over: the key in `hint`, its parameters in `details`.
    mockSend.error = Object.assign(new Error('The message is too long'), {
      hint: 'serverErrors.messageTooLong',
      details: '{"limit":4000}',
    });

    // Act
    await render(<ChatRoute />);

    // Assert
    expect(screen.getByText('В сообщении не больше 4000 символов')).toBeTruthy();
    expect(screen.queryByText(REFRESH_FAILED)).toBeNull();
  });
});
