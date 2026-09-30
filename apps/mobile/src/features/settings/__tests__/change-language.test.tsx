import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { applyLanguage } from '@/i18n';
import { stopWatchingConnection } from '@/lib/online';
import { createAppQueryClient } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';

import { saveMyLanguage } from '../api';
import { useChangeLanguage } from '../use-settings';

/**
 * The language write with the app's own query client (docs/f11-ultrareview.md,
 * finding 1). It is never paused ('always'), so the app's default for moves —
 * wait out a network failure for as long as it lasts — must not reach it: the
 * write would go on and on, and the language would never go back.
 *
 * A file of its own: before the fix the default marks the client offline, and
 * that would pause the writes of every suite sharing the module.
 */

jest.mock('../api', () => ({
  fetchMyPushPreferences: jest.fn(),
  setPushPreference: jest.fn(),
  saveMyLanguage: jest.fn(),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

jest.mock('@/i18n', () => ({
  ...jest.requireActual('@/i18n'),
  applyLanguage: jest.fn(async () => undefined),
  currentLanguage: () => 'ru',
}));

const saveLanguage = jest.mocked(saveMyLanguage);
const apply = jest.mocked(applyLanguage);

/** Longer than any number of the default's backoffs a bounded retry would need. */
const FIVE_MINUTES = 5 * 60_000;

afterEach(() => {
  stopWatchingConnection();
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

test('without signal the write gives up after one more try, and the language goes back', async () => {
  // Arrange
  jest.useFakeTimers();
  saveLanguage.mockRejectedValue(new TypeError('Network request failed'));
  const client = createAppQueryClient();
  const { result } = await renderHook(() => useChangeLanguage(), {
    wrapper: withClient(client),
  });

  // Act
  await act(async () => {
    result.current.mutate('cs');
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(FIVE_MINUTES);
  });

  // Assert
  expect(saveLanguage).toHaveBeenCalledTimes(2);
  expect(result.current.isError).toBe(true);
  expect(apply).toHaveBeenNthCalledWith(1, 'cs');
  expect(apply).toHaveBeenLastCalledWith('ru');
  client.clear();
});
