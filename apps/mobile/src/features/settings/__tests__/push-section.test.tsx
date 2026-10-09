import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { BUTTON_HEIGHT, FontSize, MIN_TOUCH_TARGET } from '@/constants/theme';

import { fetchMyPushPreferences, setPushPreference } from '../api';
import { PushSection } from '../push-section';
import type { PushKind } from '../schema';
import { registerSettingsMutations } from '../use-settings';

/**
 * Her push switches. Each kind is one row a finger finds — 48 dp at least —
 * named by its words: the whole row is the switch for a screen reader and
 * for a tap, and the system switch in it still answers a tap of its own.
 */

jest.mock('../api', () => ({
  fetchMyPushPreferences: jest.fn(),
  setPushPreference: jest.fn(),
  saveMyLanguage: jest.fn(),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    session: { user: { email: 'maria@test.local', app_metadata: { role: 'cleaner' } } },
  }),
}));

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const fetchPreferences = jest.mocked(fetchMyPushPreferences);
const setPreference = jest.mocked(setPushPreference);

function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
}

async function renderSection(): Promise<void> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  registerSettingsMutations(client);
  await render(
    <QueryClientProvider client={client}>
      <PushSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // The server's row: the digest off, as she left it; each switch rewrites it.
  let muted: readonly PushKind[] = ['daily_digest'];
  fetchPreferences.mockImplementation(async () => ({ profile_id: ME, muted: [...muted] }));
  setPreference.mockImplementation(async (kind, enabled) => {
    muted = enabled ? muted.filter((one) => one !== kind) : [...muted, kind];
    return { profile_id: ME, muted: [...muted] };
  });
});

describe('today’s switches', () => {
  test('one switch per kind she can get, each as the server has it, read once', async () => {
    await renderSection();

    expect(await screen.findByRole('switch', { name: 'Новая уборка' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Утренняя сводка' })).not.toBeChecked();
    // The cleaner gets ten kinds: every one but the head technician's «Новое задание».
    expect(screen.getAllByRole('switch')).toHaveLength(10);
  });

  test('while her row is on its way it says so', async () => {
    fetchPreferences.mockReturnValue(new Promise(() => undefined));

    await renderSection();

    expect(screen.getByText('Загружаем…')).toBeTruthy();
  });

  test('a row that could not load says so, and «Повторить» asks again', async () => {
    // Arrange
    fetchPreferences.mockRejectedValueOnce(new Error('Network request failed'));
    await renderSection();
    expect(await screen.findByText('Не удалось загрузить уведомления.')).toBeTruthy();

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    // Assert
    await waitFor(() => expect(fetchPreferences).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('switch', { name: 'Новая уборка' })).toBeTruthy();
  });
});

describe('on the «Абрикос» components', () => {
  test('each kind is a row at least 48 dp high, its words on body text', async () => {
    await renderSection();

    const row = await screen.findByRole('switch', { name: 'Новая уборка' });
    expect(styleOf(row).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(styleOf(screen.getByText('Новая уборка')).fontSize).toBe(FontSize.body);
  });

  test('a tap anywhere on the row turns its kind off, and on again', async () => {
    // Arrange
    await renderSection();
    const row = await screen.findByRole('switch', { name: 'Новая уборка' });

    // Act
    await fireEvent.press(row);

    // Assert
    await waitFor(() => expect(setPreference).toHaveBeenCalledWith('cleaning_new', false));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Новая уборка' })).not.toBeChecked(),
    );

    // Act: the digest she had off.
    await fireEvent.press(screen.getByRole('switch', { name: 'Утренняя сводка' }));

    // Assert
    await waitFor(() => expect(setPreference).toHaveBeenCalledWith('daily_digest', true));
  });

  test('the system switch in the row still answers a tap of its own', async () => {
    // Arrange
    await renderSection();
    await screen.findByRole('switch', { name: 'Новая уборка' });
    const control = screen.getByTestId('push-switch-cleaning_new', { includeHiddenElements: true });

    // Act
    await fireEvent(control, 'valueChange', false);

    // Assert
    await waitFor(() => expect(setPreference).toHaveBeenCalledWith('cleaning_new', false));
    // And the tap stops at the switch: a control that let it bubble up to the
    // row would flip the kind twice — off by the switch, on again by the row.
    const claimsTouch = control.props.onStartShouldSetResponder as (() => boolean) | undefined;
    expect(claimsTouch?.()).toBe(true);
  });

  test('«Повторить» is a 56 dp button', async () => {
    fetchPreferences.mockRejectedValueOnce(new Error('Network request failed'));

    await renderSection();

    const retry = await screen.findByRole('button', { name: 'Повторить' });
    expect(styleOf(retry).minHeight).toBe(BUTTON_HEIGHT);
  });
});
