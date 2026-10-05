import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import RootLayout, { ErrorBoundary } from '@/app/_layout';
import { markAppDrawn } from '@/components/route-error';
import { useAppReady } from '@/lib/app-ready';

/**
 * The root layout's ready gate. Until the font is in and her theme restored
 * the root draws nothing, and the root boundary still lets a render error
 * through, so a build whose first screen cannot draw crashes and expo-updates
 * rolls it back. Once ready the providers and the screens mount, and from that
 * commit on the root boundary catches (components/route-error.tsx).
 */

jest.mock('@/lib/app-ready', () => ({ holdSplash: jest.fn(), useAppReady: jest.fn() }));

// The real switch, watched: the boundary below reads the flag it flips.
jest.mock('@/components/route-error', () => {
  const actual = jest.requireActual('@/components/route-error');
  return { ...actual, markAppDrawn: jest.fn(actual.markAppDrawn) };
});

interface MockChildren {
  children?: ReactNode;
}

// The providers reduced to a mark that they mounted; each has its own tests.
// Built here, read only when drawn: by then the imports above are in.
function mockMarkedProvider(testID: string) {
  return function MarkedProvider({ children }: MockChildren) {
    return <View testID={testID}>{children}</View>;
  };
}

function mockPassThrough({ children }: MockChildren) {
  return <>{children}</>;
}

/** What the root declares for each screen of the stack, by route name. */
const mockScreenOptions = new Map<string, unknown>();

function mockStack({ children }: MockChildren) {
  return (
    <>
      <Text>stack</Text>
      {children}
    </>
  );
}

function mockScreen({ name, options }: { name: string; options?: unknown }) {
  mockScreenOptions.set(name, options);
  return null;
}

jest.mock('@tanstack/react-query-persist-client', () => ({
  PersistQueryClientProvider: mockMarkedProvider('query-cache'),
}));
jest.mock('@/features/auth/session', () => ({
  SessionProvider: mockMarkedProvider('session'),
}));
jest.mock('@/features/profile/language-gate', () => ({ ProfileLanguageGate: mockPassThrough }));
jest.mock('@/features/push/push-bridge', () => ({ PushBridge: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: mockPassThrough }));
jest.mock('expo-router', () => {
  const Stack = Object.assign(mockStack, { Screen: mockScreen });
  const stock = { dark: false, colors: {}, fonts: {} };
  return { Stack, ThemeProvider: mockPassThrough, DarkTheme: stock, DefaultTheme: stock };
});

jest.mock('@/lib/query-client', () => ({
  createAppQueryClient: jest.fn(() => ({})),
  persistOptions: {},
  forgetSavedQueries: jest.fn(async () => {}),
}));
jest.mock('@/lib/app-focus', () => ({ subscribeFocusToAppState: jest.fn(() => () => {}) }));
jest.mock('@/lib/network', () => ({ watchNetwork: jest.fn(() => () => {}) }));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn(async () => undefined) }));
jest.mock('@/lib/sentry', () => ({ reportError: jest.fn() }));

const readiness = jest.mocked(useAppReady);
const SCREEN_FAILED = 'Не удалось показать экран. Попробуйте ещё раз.';

// Order matters: the first draw is a one-way switch for the app's life.
test('while the splash is up nothing mounts below the root, and the root boundary still lets an error through', async () => {
  // Arrange: React reports the uncaught error on the console; that is expected here.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  readiness.mockReturnValue({ isReady: false, areFontsLoaded: false });

  // Act
  await render(<RootLayout />);

  // Assert
  expect(screen.queryByTestId('query-cache')).toBeNull();
  expect(screen.queryByTestId('session')).toBeNull();
  expect(screen.queryByText('stack')).toBeNull();
  expect(markAppDrawn).not.toHaveBeenCalled();
  await expect(
    render(<ErrorBoundary error={new Error('broken first screen')} retry={jest.fn(async () => {})} />),
  ).rejects.toThrow('broken first screen');
});

test('once ready the providers and the stack mount, and from then on the root boundary catches', async () => {
  // Arrange: the splash is still up on the first render.
  readiness.mockReturnValue({ isReady: false, areFontsLoaded: false });
  const { rerender } = await render(<RootLayout />);
  expect(markAppDrawn).not.toHaveBeenCalled();

  // Act: the font is in and her theme restored.
  readiness.mockReturnValue({ isReady: true, areFontsLoaded: true });
  await rerender(<RootLayout />);

  // Assert
  expect(screen.getByTestId('query-cache')).toBeTruthy();
  expect(screen.getByTestId('session')).toBeTruthy();
  expect(screen.getByText('stack')).toBeTruthy();
  expect(markAppDrawn).toHaveBeenCalledTimes(1);
  await render(<ErrorBoundary error={new Error('later')} retry={jest.fn(async () => {})} />);
  expect(screen.getByText(SCREEN_FAILED)).toBeTruthy();
});

// The three screens of a report had no header at all — no title, no way back
// (docs/redesign-plan.md §2.4). The title is the root's, not the screen's: a
// report still loading, or one that failed, is drawn under the same header.
test.each([
  ['problem/new', 'Новое задание'],
  ['problem/[id]/index', 'Задание'],
  ['problem/[id]/edit', 'Изменить задание'],
])('%s has a header titled «%s» and a way back', async (name, title) => {
  // Arrange
  readiness.mockReturnValue({ isReady: true, areFontsLoaded: true });

  // Act
  await render(<RootLayout />);

  // Assert
  expect(mockScreenOptions.get(name)).toEqual(
    expect.objectContaining({ headerShown: true, headerBackTitle: 'Назад', title }),
  );
});
