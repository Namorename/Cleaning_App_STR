import { render, screen } from '@testing-library/react-native';

import TaskRoute from '@/app/task/[id]';

/**
 * A notification opens the app cold, straight onto the cleaning. The stored
 * session is read a moment later; until then the screen must not say the
 * cleaning is gone.
 */

const mockSession = { userId: null as string | null, isLoading: true };

jest.mock('@/features/auth/session', () => ({
  useSession: () => mockSession,
}));

jest.mock('expo-router', () => ({
  Redirect: () => null,
  Stack: { Screen: () => null },
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b' }),
}));

test('opened before the session is read, it waits instead of saying the cleaning is gone', async () => {
  await render(<TaskRoute />);

  expect(screen.getByText('Загружаем уборки…')).toBeTruthy();
  expect(screen.queryByText('Уборка не найдена или больше не ваша')).toBeNull();
});
