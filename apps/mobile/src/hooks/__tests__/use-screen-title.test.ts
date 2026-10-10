import { act, renderHook } from '@testing-library/react-native';

import { useScreenTitle } from '../use-screen-title';

/**
 * The header's title is set while the screen is on top, once per title, and
 * never once the screen is on its way out: on Android a header updated in
 * the pop's moment brings the whole app down (Sentry, 2026-10-09 and 10-10:
 * «ScreenStackFragment added into a non-stack container»).
 */

type Listener = () => void;

const mockNavigation = {
  isFocusedNow: true,
  listeners: new Map<string, Set<Listener>>(),
  setOptions: jest.fn(),
  isFocused: () => mockNavigation.isFocusedNow,
  addListener: jest.fn((event: string, listener: Listener) => {
    const listeners = mockNavigation.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    mockNavigation.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }),
};

jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));

async function navigationEvent(event: 'beforeRemove' | 'blur' | 'focus'): Promise<void> {
  await act(async () => {
    if (event === 'blur') {
      mockNavigation.isFocusedNow = false;
    }
    if (event === 'focus') {
      mockNavigation.isFocusedNow = true;
    }
    mockNavigation.listeners.get(event)?.forEach((listener) => listener());
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNavigation.isFocusedNow = true;
  mockNavigation.listeners.clear();
});

test('sets the title once, and again only when it changes', async () => {
  const { rerender } = await renderHook(({ title }: { title: string }) => useScreenTitle(title), {
    initialProps: { title: 'Ванная' },
  });
  expect(mockNavigation.setOptions).toHaveBeenCalledTimes(1);
  expect(mockNavigation.setOptions).toHaveBeenLastCalledWith({ title: 'Ванная' });

  // The upload's percent redraws the screen many times a second.
  await rerender({ title: 'Ванная' });
  await rerender({ title: 'Ванная' });
  expect(mockNavigation.setOptions).toHaveBeenCalledTimes(1);

  await rerender({ title: 'Кухня' });
  expect(mockNavigation.setOptions).toHaveBeenCalledTimes(2);
  expect(mockNavigation.setOptions).toHaveBeenLastCalledWith({ title: 'Кухня' });
});

test('back first, then the title changes: the header is left alone', async () => {
  const { rerender } = await renderHook(({ title }: { title: string }) => useScreenTitle(title), {
    initialProps: { title: 'Ванная' },
  });
  mockNavigation.setOptions.mockClear();

  await navigationEvent('beforeRemove');
  await rerender({ title: 'Ванная — выполнено' });

  expect(mockNavigation.setOptions).not.toHaveBeenCalled();
});

test('covered by another screen it waits, and on top again it says the latest', async () => {
  const { rerender } = await renderHook(({ title }: { title: string }) => useScreenTitle(title), {
    initialProps: { title: 'Ванная' },
  });
  mockNavigation.setOptions.mockClear();

  await navigationEvent('blur');
  await rerender({ title: 'Кухня' });
  expect(mockNavigation.setOptions).not.toHaveBeenCalled();

  await navigationEvent('focus');
  expect(mockNavigation.setOptions).toHaveBeenCalledTimes(1);
  expect(mockNavigation.setOptions).toHaveBeenLastCalledWith({ title: 'Кухня' });
});

test('no title yet: the layout keeps its own', async () => {
  await renderHook(() => useScreenTitle(undefined));
  expect(mockNavigation.setOptions).not.toHaveBeenCalled();
});

test('the listeners go with the screen', async () => {
  const { unmount } = await renderHook(() => useScreenTitle('Ванная'));
  await unmount();
  for (const listeners of mockNavigation.listeners.values()) {
    expect(listeners.size).toBe(0);
  }
});
