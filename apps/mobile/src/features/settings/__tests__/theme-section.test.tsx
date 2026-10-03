import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Appearance } from 'react-native';

import { THEME_PREFERENCE_KEY, chooseThemePreference } from '@/lib/theme-preference';

import { ThemeSection } from '../theme-section';

/**
 * «Тема» in the settings: as the system, light or dark (owner's decision 6).
 * The choice is applied at once and kept on this phone.
 */

jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn(async () => undefined) }));
jest.mock('@/lib/sentry', () => ({ reportError: jest.fn() }));

const setScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await chooseThemePreference('system');
});

test('a titled block with the three choices, the current one checked', async () => {
  await render(<ThemeSection />);

  expect(screen.getByRole('header', { name: 'Тема' })).toBeTruthy();
  expect(screen.getByText('Только на этом телефоне.')).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Как в системе' })).toBeSelected();
  expect(screen.getByRole('radio', { name: 'Светлая' })).not.toBeSelected();
  expect(screen.getByRole('radio', { name: 'Тёмная' })).not.toBeSelected();
});

test('«Тёмная» applies the dark theme at once and remembers it', async () => {
  await render(<ThemeSection />);

  await fireEvent.press(screen.getByRole('radio', { name: 'Тёмная' }));

  expect(setScheme).toHaveBeenLastCalledWith('dark');
  expect(screen.getByRole('radio', { name: 'Тёмная' })).toBeSelected();
  await expect(AsyncStorage.getItem(THEME_PREFERENCE_KEY)).resolves.toBe('dark');
});

test('a choice that cannot be kept says so, with the reason small under it', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('Disk full'));
  await render(<ThemeSection />);

  await fireEvent.press(screen.getByRole('radio', { name: 'Светлая' }));

  expect(
    await screen.findByText('Тема сменилась, но не запомнилась: после перезапуска вернётся прежняя.'),
  ).toBeTruthy();
  expect(screen.getByText('Disk full')).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Светлая' })).toBeSelected();
});
