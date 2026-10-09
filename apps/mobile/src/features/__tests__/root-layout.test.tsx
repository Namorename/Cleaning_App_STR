import type { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import RootLayout, { ErrorBoundary } from '@/app/_layout';
import { markAppDrawn } from '@/components/route-error';
import { forgetListsOnSignOut } from '@/features/auth/forget-on-sign-out';
import { useAppReady } from '@/lib/app-ready';
import { createAppQueryClient } from '@/lib/query-client';

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

/** What the root handed the cache's provider: when the restore succeeded, and when it failed. */
const mockPersistProps: { onSuccess?: () => unknown; onError?: () => unknown } = {};

function mockPersistProvider(props: MockChildren & typeof mockPersistProps) {
  mockPersistProps.onSuccess = props.onSuccess;
  mockPersistProps.onError = props.onError;
  return <View testID="query-cache">{props.children}</View>;
}

jest.mock('@tanstack/react-query-persist-client', () => ({
  PersistQueryClientProvider: mockPersistProvider,
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
  resumeSavedMoves: jest.fn(async () => {}),
}));
jest.mock('@/features/auth/forget-on-sign-out', () => ({
  // The gate as the real one is, without its wait: two promises and the
  // hands that settle them.
  createRestoreGate: () => {
    let open: () => void = () => undefined;
    let markChecked: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      open = resolve;
    });
    const checked = new Promise<void>((resolve) => {
      markChecked = resolve;
    });
    return { done, open, checked, markChecked };
  },
  forgetListsOnSignOut: jest.fn(() => () => {}),
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

// Item 10 of the two whole-branch reviews of phone-1-2-0: the app's one query
// client forgets the lists of whoever signs out, for the whole run.
test('listens for a sign-out with the app’s query client, and lets go when it unmounts', async () => {
  // Arrange
  const client = { name: 'the app’s client' };
  jest.mocked(createAppQueryClient).mockReturnValueOnce(client as unknown as QueryClient);
  const stop = jest.fn();
  jest.mocked(forgetListsOnSignOut).mockReturnValueOnce(stop);
  readiness.mockReturnValue({ isReady: false, areFontsLoaded: false });

  // Act
  const { unmount } = await render(<RootLayout />);
  await unmount();

  // Assert
  expect(forgetListsOnSignOut).toHaveBeenCalledWith(
    client,
    expect.any(Promise),
    expect.any(Function),
  );
  expect(stop).toHaveBeenCalledTimes(1);
});

/** Whether the promise has settled by the time the microtasks queued so far have run. */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  let isSettled = false;
  void promise.then(() => {
    isSettled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return isSettled;
}

// The verification review of f3217a7..c466bf5, item 2: nothing is forgotten
// before the cache is back from disk, or the restore would bring it back.
test.each([
  ['comes back', 'onSuccess'],
  ['cannot be read', 'onError'],
] as const)('the watch on whose lists the cache holds waits until the cache %s', async (_, how) => {
  // Arrange
  jest.mocked(forgetListsOnSignOut).mockClear();
  readiness.mockReturnValue({ isReady: true, areFontsLoaded: true });
  await render(<RootLayout />);
  const [, restored] = jest.mocked(forgetListsOnSignOut).mock.calls[0] as unknown as [
    unknown,
    Promise<void>,
  ];
  expect(await hasSettled(restored)).toBe(false);

  // Act
  void mockPersistProps[how]?.();

  // Assert
  expect(await hasSettled(restored)).toBe(true);
});

// The verification review of c466bf5..bc7dcc9, item 5: the provider lets the
// screens draw what it restored once its onSuccess settles — and that waits
// for the lists to be checked against whose they are, so the last person's
// never draw for a frame before being forgotten.
test('the cache counts as restored only once whose lists it holds has been checked', async () => {
  // Arrange
  jest.mocked(forgetListsOnSignOut).mockClear();
  readiness.mockReturnValue({ isReady: true, areFontsLoaded: true });
  await render(<RootLayout />);
  const [, , markChecked] = jest.mocked(forgetListsOnSignOut).mock.calls[0] as unknown as [
    unknown,
    unknown,
    () => void,
  ];

  // Act
  const restored = Promise.resolve(mockPersistProps.onSuccess?.());

  // Assert: held until the check says so.
  expect(await hasSettled(restored)).toBe(false);
  markChecked();
  expect(await hasSettled(restored)).toBe(true);
});

// The three screens of a report had no header at all — no title, no way back
// (docs/redesign-plan.md §2.4). The title is the root's, not the screen's: a
// report still loading, or one that failed, is drawn under the same header.
// The two screens of a supply request had none either (the same §2.4); a
// rewrite of a request is the form's screen, and the form retitles it.
test.each([
  ['problem/new', 'Новое задание'],
  ['problem/[id]/index', 'Задание'],
  ['problem/[id]/edit', 'Изменить задание'],
  // The head technician's history of a task, titled the same way.
  ['problem/[id]/history', 'История задания'],
  ['supply/new', 'Новая заявка'],
  ['supply/[id]', 'Заявка на расходники'],
  // A video step's camera: titled by the root, since the screen may draw a
  // permission question or a failure before the camera.
  ['task/[id]/step/[stepId]/record', 'Запись видео'],
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
