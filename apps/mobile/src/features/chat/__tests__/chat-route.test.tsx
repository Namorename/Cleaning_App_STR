import { render, screen } from '@testing-library/react-native';

import ChatRoute from '@/app/chat/[subject]/[id]';

/**
 * A notification about a message opens the app cold, straight onto the
 * thread. The stored session is read a moment later; until then the screen
 * must not say the chat is unavailable.
 */

const mockSession = { userId: null as string | null, isLoading: true };

jest.mock('@/features/auth/session', () => ({
  useSession: () => mockSession,
}));

jest.mock('expo-router', () => ({
  Redirect: () => null,
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ subject: 'task', id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b' }),
}));

test('opened before the session is read, it waits instead of saying the chat is unavailable', async () => {
  await render(<ChatRoute />);

  expect(screen.getByText('Загружаем сообщения…')).toBeTruthy();
  expect(screen.queryByText('Этот чат недоступен')).toBeNull();
});
