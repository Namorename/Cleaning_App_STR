import { IsRestoringProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { SignedInRoute } from '../signed-in-route';

/**
 * A route on the root stack, above the tabs whose redirect guards the rest of
 * the app. A tap on a notification opens the app straight onto such a route,
 * before the stored session has been read: until it has, "not found" would be
 * a lie, and a redirect to sign-in would throw away the place she was sent.
 */

const mockSession = { userId: null as string | null, isLoading: false };
const mockRedirect = jest.fn();

jest.mock('../session', () => ({
  useSession: () => mockSession,
}));

jest.mock('expo-router', () => ({
  Redirect: function Redirect({ href }: { href: string }) {
    mockRedirect(href);
    return null;
  },
}));

function Screen() {
  return <Text>the screen</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.userId = null;
  mockSession.isLoading = false;
});

test('while the stored session is being read, it says it is loading and waits', async () => {
  // Arrange
  mockSession.isLoading = true;

  // Act
  await render(
    <SignedInRoute loadingText="Загружаем уборки…">
      <Screen />
    </SignedInRoute>,
  );

  // Assert
  expect(screen.getByText('Загружаем уборки…')).toBeTruthy();
  expect(screen.queryByText('the screen')).toBeNull();
  expect(mockRedirect).not.toHaveBeenCalled();
});

test('signed out, it leads to the sign-in screen', async () => {
  await render(
    <SignedInRoute loadingText="Загружаем уборки…">
      <Screen />
    </SignedInRoute>,
  );

  expect(mockRedirect).toHaveBeenCalledWith('/sign-in');
  expect(screen.queryByText('the screen')).toBeNull();
});

test('signed in, it shows the screen', async () => {
  mockSession.userId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  await render(
    <SignedInRoute loadingText="Загружаем уборки…">
      <Screen />
    </SignedInRoute>,
  );

  expect(screen.getByText('the screen')).toBeTruthy();
  expect(mockRedirect).not.toHaveBeenCalled();
});

test('the wait is one element for the reader: a busy progress bar in the screen’s words', async () => {
  mockSession.isLoading = true;

  await render(
    <SignedInRoute loadingText="Загружаем уборки…">
      <Screen />
    </SignedInRoute>,
  );

  const loading = screen.getByRole('progressbar', { name: 'Загружаем уборки…' });
  expect(loading.props.accessibilityState).toMatchObject({ busy: true });
});

/**
 * The cache is back from disk before it is checked against whose it is
 * (features/auth/forget-on-sign-out.ts): a session known in between drew the
 * last person's lists for a frame (docs/post-launch-cleanup.md). Until the
 * check is done the provider says it is still restoring, and the screen waits.
 */
test('signed in while the lists brought back are still being checked: it waits, and says so', async () => {
  // Arrange
  mockSession.userId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  // Act
  await render(
    <IsRestoringProvider value>
      <SignedInRoute loadingText="Загружаем уборки…">
        <Screen />
      </SignedInRoute>
    </IsRestoringProvider>,
  );

  // Assert
  expect(screen.getByText('Загружаем уборки…')).toBeTruthy();
  expect(screen.queryByText('the screen')).toBeNull();
  expect(mockRedirect).not.toHaveBeenCalled();
});
