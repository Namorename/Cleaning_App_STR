import { act, renderHook } from '@testing-library/react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

import { NUNITO_FAMILY } from '@/components/text';
import { reportError } from '@/lib/sentry';

import { FONT_WAIT_MS, holdSplash, useAppReady } from '../app-ready';

/**
 * Nunito comes over the air with the update: four files, loaded at start. The
 * splash holds the first screen back until they are in, so she never sees the
 * app jump from the system font to its own — but a font that fails, or never
 * answers, must not leave her on the splash (docs/redesign-plan.md §2.2).
 */

jest.mock('expo-font', () => ({ useFonts: jest.fn() }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hide: jest.fn(),
}));
jest.mock('@/lib/sentry', () => ({ reportError: jest.fn() }));

const fonts = jest.mocked(useFonts);
const hide = jest.mocked(SplashScreen.hide);

beforeEach(() => {
  jest.clearAllMocks();
});

test('loads the four weights, each under the family the text component draws', async () => {
  fonts.mockReturnValue([true, null]);

  await renderHook(() => useAppReady());

  const map = fonts.mock.calls[0][0] as Record<string, unknown>;
  expect(Object.keys(map).sort()).toEqual(Object.values(NUNITO_FAMILY).sort());
});

test('holds the splash until the font is in, then lets it go', async () => {
  fonts.mockReturnValue([false, null]);
  const { result, rerender } = await renderHook(() => useAppReady());
  expect(result.current).toEqual({ isReady: false, areFontsLoaded: false });
  expect(hide).not.toHaveBeenCalled();

  fonts.mockReturnValue([true, null]);
  await rerender({});

  expect(result.current).toEqual({ isReady: true, areFontsLoaded: true });
  expect(hide).toHaveBeenCalledTimes(1);
});

test('a font that fails goes on in the system font, and the failure is reported', async () => {
  const failure = new Error('Font file is corrupt');
  fonts.mockReturnValue([false, failure]);

  const { result } = await renderHook(() => useAppReady());

  expect(result.current).toEqual({ isReady: true, areFontsLoaded: false });
  expect(hide).toHaveBeenCalledTimes(1);
  expect(reportError).toHaveBeenCalledWith(failure);
});

test('a font that never answers does not keep her on the splash', async () => {
  jest.useFakeTimers();
  try {
    fonts.mockReturnValue([false, null]);
    const { result } = await renderHook(() => useAppReady());
    expect(result.current.isReady).toBe(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(FONT_WAIT_MS);
    });

    expect(result.current).toEqual({ isReady: true, areFontsLoaded: false });
    expect(hide).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('holdSplash asks the splash to stay up', () => {
  holdSplash();

  expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalledTimes(1);
});

test('a splash that cannot be held is reported, not thrown', async () => {
  const failure = new Error('No splash module');
  jest.mocked(SplashScreen.preventAutoHideAsync).mockRejectedValueOnce(failure);

  holdSplash();
  await act(async () => {});

  expect(reportError).toHaveBeenCalledWith(failure);
});
