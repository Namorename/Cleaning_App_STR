import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEME_COLORS } from '@str-ops/shared';
import { act, renderHook } from '@testing-library/react-native';
import * as SystemUI from 'expo-system-ui';
import { Appearance } from 'react-native';

import { reportError } from '@/lib/sentry';

import {
  THEME_PREFERENCE_KEY,
  chooseThemePreference,
  restoreThemePreference,
  useSystemBackground,
  useThemePreference,
} from '../theme-preference';

/**
 * Her theme: as the system, light or dark (owner's decision 6), chosen in the
 * settings and kept on this phone. React Native's Appearance carries it to
 * every screen; the root view behind them is painted to match, so no white
 * edge flashes in the dark theme (docs/redesign-plan.md §2.2, §5).
 */

jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn(async () => undefined) }));
jest.mock('@/lib/sentry', () => ({ reportError: jest.fn() }));

const setScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('at start', () => {
  test('nothing chosen yet: the system decides, and Appearance is left alone', async () => {
    await expect(restoreThemePreference()).resolves.toBe('system');

    expect(setScheme).not.toHaveBeenCalled();
  });

  test('a saved choice is applied before the first screen', async () => {
    await AsyncStorage.setItem(THEME_PREFERENCE_KEY, 'dark');

    await expect(restoreThemePreference()).resolves.toBe('dark');

    expect(setScheme).toHaveBeenCalledWith('dark');
  });

  test('a value this build does not know is the system', async () => {
    await AsyncStorage.setItem(THEME_PREFERENCE_KEY, 'sepia');

    await expect(restoreThemePreference()).resolves.toBe('system');
    expect(setScheme).not.toHaveBeenCalled();
  });

  test('a store that cannot be read: the system, and the failure is reported', async () => {
    const failure = new Error('Storage is broken');
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(failure);

    await expect(restoreThemePreference()).resolves.toBe('system');
    expect(reportError).toHaveBeenCalledWith(failure);
  });
});

describe('choosing', () => {
  test('applies at once and is remembered', async () => {
    await chooseThemePreference('light');

    expect(setScheme).toHaveBeenLastCalledWith('light');
    await expect(AsyncStorage.getItem(THEME_PREFERENCE_KEY)).resolves.toBe('light');
  });

  test('«Как в системе» hands the choice back to the system', async () => {
    await chooseThemePreference('system');

    expect(setScheme).toHaveBeenLastCalledWith('unspecified');
    await expect(AsyncStorage.getItem(THEME_PREFERENCE_KEY)).resolves.toBe('system');
  });

  test('a choice that cannot be saved still applies, and the caller hears of it', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('Disk full'));

    await expect(chooseThemePreference('dark')).rejects.toThrow('Disk full');
    expect(setScheme).toHaveBeenLastCalledWith('dark');
  });

  test('the settings follow the choice', async () => {
    await chooseThemePreference('system');
    const { result } = await renderHook(() => useThemePreference());
    expect(result.current).toBe('system');

    await act(async () => {
      await chooseThemePreference('dark');
    });

    expect(result.current).toBe('dark');
  });
});

test('the root view is painted with the theme’s background, and repainted when it changes', async () => {
  const { rerender } = await renderHook(
    ({ scheme }: { scheme: 'light' | 'dark' }) => useSystemBackground(scheme),
    { initialProps: { scheme: 'light' } },
  );
  expect(SystemUI.setBackgroundColorAsync).toHaveBeenLastCalledWith(THEME_COLORS.light.bg);

  await rerender({ scheme: 'dark' });

  expect(SystemUI.setBackgroundColorAsync).toHaveBeenLastCalledWith(THEME_COLORS.dark.bg);
});
