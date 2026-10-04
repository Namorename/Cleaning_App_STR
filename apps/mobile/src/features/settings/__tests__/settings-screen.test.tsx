import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { SUPPORTED_LANGUAGES, deviceLanguage, i18n } from '@/i18n';

import { fetchMyPushPreferences, saveMyLanguage, setPushPreference } from '../api';
import { SettingsScreen } from '../settings-screen';
import { registerSettingsMutations } from '../use-settings';

/**
 * The settings screen as the cleaner meets it: which pushes she wants, the
 * language she reads, her password, and the way out at the bottom.
 *
 * Tests read Russian: that is the language jest.setup fixes for the app.
 */

jest.mock('../api', () => ({
  fetchMyPushPreferences: jest.fn(),
  setPushPreference: jest.fn(),
  saveMyLanguage: jest.fn(),
}));

// The password section and the sign-out button talk to auth; nothing here
// presses them, and the real client has no business starting in a test.
jest.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    session: { user: { email: 'maria@test.local' } },
  }),
  signOut: jest.fn(),
}));

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const fetchPreferences = jest.mocked(fetchMyPushPreferences);
const setPreference = jest.mocked(setPushPreference);
const saveLanguage = jest.mocked(saveMyLanguage);

/** The push kinds in the order the screen lists them, as she reads them. */
const KIND_LABELS = [
  'Новая уборка',
  'Вам назначена уборка',
  'Уборку сняли с вас',
  'Уборка отменена',
  'Уборка перенесена',
  'Изменилось время уборки',
  'Свободная уборка',
  'Бронь отменена во время уборки',
  'Новое задание',
  'Сообщение в чате',
  'Утренняя сводка',
];

/**
 * Drawn and settled: her row has arrived and the switches are on screen, so
 * no answer lands after a test has finished looking.
 */
async function renderScreen(): Promise<QueryClient> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  registerSettingsMutations(client);
  await render(
    <QueryClientProvider client={client}>
      <SettingsScreen />
    </QueryClientProvider>,
  );
  await screen.findAllByRole('switch');
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchPreferences.mockResolvedValue({ profile_id: ME, muted: ['daily_digest'] });
});

// Every test here may switch the one i18next instance; the next starts from
// the phone's own language.
afterEach(async () => {
  await i18n.changeLanguage(deviceLanguage());
});

test('shows the three sections and the way out at the bottom', async () => {
  // Act
  await renderScreen();

  // Assert
  expect(screen.getByRole('header', { name: 'Уведомления' })).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Язык' })).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Пароль' })).toBeTruthy();
  expect(screen.getByText('Переключатели решают, что сервер будет вам присылать.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Выйти' })).toBeTruthy();
});

test('lists one switch per push kind, in order, each as the server has it', async () => {
  // Act
  await renderScreen();

  // Assert
  await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(KIND_LABELS.length));
  const labels = screen
    .getAllByRole('switch')
    .map((element) => element.props.accessibilityLabel as string);
  expect(labels).toEqual(KIND_LABELS);
  expect(screen.getByRole('switch', { name: 'Утренняя сводка' })).not.toBeChecked();
  expect(screen.getByRole('switch', { name: 'Новая уборка' })).toBeChecked();
});

test('a switch sends the value she wants', async () => {
  // Arrange
  setPreference.mockResolvedValue({ profile_id: ME, muted: ['cleaning_new', 'daily_digest'] });
  await renderScreen();
  const newCleaning = await screen.findByRole('switch', { name: 'Новая уборка' });

  // Act
  await fireEvent(newCleaning, 'valueChange', false);

  // Assert
  await waitFor(() => expect(setPreference).toHaveBeenCalledWith('cleaning_new', false));
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'Новая уборка' })).not.toBeChecked(),
  );
});

test('a refused switch goes back and says why', async () => {
  // Arrange
  setPreference.mockRejectedValue({ message: 'Only an active person can change her pushes' });
  await renderScreen();
  const digest = await screen.findByRole('switch', { name: 'Утренняя сводка' });

  // Act
  await fireEvent(digest, 'valueChange', true);

  // Assert
  expect(await screen.findByText('Выбор не сохранился.')).toBeTruthy();
  expect(screen.getByText('Only an active person can change her pushes')).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Утренняя сводка' })).not.toBeChecked();
});

test('offers every language the app speaks, each named in itself', async () => {
  await renderScreen();

  const names = screen.getAllByRole('radio').map((element) => element.props.accessibilityLabel);

  expect(names).toEqual(['Русский', 'English', 'Čeština']);
  expect(names).toHaveLength(SUPPORTED_LANGUAGES.length);
  expect(screen.getByRole('radio', { name: 'Русский' })).toBeSelected();
});

test('a language is applied on the tap, then written to her profile', async () => {
  // Arrange: the write is held, so what shows is the tap's doing, not the server's.
  let finish: () => void = () => {};
  saveLanguage.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await renderScreen();

  // Act
  await fireEvent.press(screen.getByRole('radio', { name: 'English' }));

  // Assert
  expect(i18n.language).toBe('en');
  expect(screen.getByRole('header', { name: 'Language' })).toBeTruthy();
  expect(saveLanguage).toHaveBeenCalledWith(ME, 'en');
  expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();
  // One change at a time: the others wait while this one is being saved.
  expect(screen.getByRole('radio', { name: 'Čeština' })).toBeDisabled();

  // Act: the server agrees.
  await act(async () => {
    finish();
  });

  // Assert: the choices open again, and the language stays.
  await waitFor(() => expect(screen.getByRole('radio', { name: 'Čeština' })).toBeEnabled());
  expect(i18n.language).toBe('en');
});

test('a language that could not be saved goes back to the one before, and says so', async () => {
  // Arrange
  saveLanguage.mockRejectedValue(new Error('Own profile row was not updated'));
  await renderScreen();

  // Act
  await fireEvent.press(screen.getByRole('radio', { name: 'Čeština' }));

  // Assert
  await waitFor(() => expect(i18n.language).toBe('ru'));
  expect(await screen.findByText('Язык не сменился.')).toBeTruthy();
  expect(screen.getByText('Own profile row was not updated')).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Русский' })).toBeSelected();
});
