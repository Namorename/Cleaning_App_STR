import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { SUPPORTED_LANGUAGES, deviceLanguage, i18n } from '@/i18n';
import { setWordContext } from '@/testing/word-context';

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

// «О приложении» opens the font licence through the router; nothing here opens it.
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

/** Her role as the token carries it; a cleaner unless a test says otherwise. */
let mockRole = 'cleaner';

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    session: { user: { email: 'maria@test.local', app_metadata: { role: mockRole } } },
  }),
  signOut: jest.fn(),
}));

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const fetchPreferences = jest.mocked(fetchMyPushPreferences);
const setPreference = jest.mocked(setPushPreference);
const saveLanguage = jest.mocked(saveMyLanguage);

/** The one switch only the head technician is shown (owner's word 2026-10-03). */
const NEW_TASK = 'Новое задание';

/** Every push kind's switch, in the enum's order, as a cleaner reads it. */
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
  mockRole = 'cleaner';
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

/** The switches on screen, top to bottom, by the words they carry. */
function switchLabels(): string[] {
  return screen.getAllByRole('switch').map((element) => element.props.accessibilityLabel as string);
}

/**
 * A technician's pushes are about his jobs (docs/tech-plan.md §5): seven
 * kinds, not ten, each named as work — the session applied his words (§6).
 */
const TECHNICIAN_LABELS = [
  'Вам назначена работа',
  'Работу сняли с вас',
  'Работа отменена',
  'Работа перенесена',
  'Изменилось время работы',
  'Сообщение в чате',
  'Утренняя сводка',
];

describe('a technician', () => {
  beforeEach(async () => {
    await setWordContext('tech');
  });

  afterEach(async () => {
    await setWordContext(undefined);
  });

  test('the technician gets his seven switches, in order, each named as work', async () => {
    // Arrange
    mockRole = 'tech';

    // Act
    await renderScreen();

    // Assert
    await waitFor(() =>
      expect(screen.getAllByRole('switch')).toHaveLength(TECHNICIAN_LABELS.length),
    );
    expect(switchLabels()).toEqual(TECHNICIAN_LABELS);
    expect(screen.getByRole('switch', { name: 'Утренняя сводка' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Вам назначена работа' })).toBeChecked();
    for (const gone of ['Новая уборка', 'Свободная уборка', 'Бронь отменена во время уборки']) {
      expect(screen.queryByText(gone, { includeHiddenElements: true })).toBeNull();
    }
    expect(screen.queryByText(NEW_TASK, { includeHiddenElements: true })).toBeNull();
  });

  test('the head technician gets the same, and «Новое задание» — eight switches', async () => {
    // Arrange
    mockRole = 'head_tech';

    // Act
    await renderScreen();

    // Assert
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(8));
    expect(switchLabels()).toEqual([
      ...TECHNICIAN_LABELS.slice(0, 5),
      NEW_TASK,
      ...TECHNICIAN_LABELS.slice(5),
    ]);
    expect(screen.getByRole('switch', { name: NEW_TASK })).toBeChecked();
  });

  test('his switch sends the kind the server knows', async () => {
    // Arrange
    mockRole = 'tech';
    setPreference.mockResolvedValue({
      profile_id: ME,
      muted: ['cleaning_moved', 'daily_digest'],
    });
    await renderScreen();

    // Act
    await fireEvent.press(await screen.findByRole('switch', { name: 'Работа перенесена' }));

    // Assert
    await waitFor(() => expect(setPreference).toHaveBeenCalledWith('cleaning_moved', false));
  });
});

test.each(['cleaner', 'manager', 'admin'])(
  'a %s has no new-task switch at all, and every other one in its place',
  async (role) => {
    // Arrange
    mockRole = role;

    // Act
    await renderScreen();

    // Assert: not a switch turned off or greyed out — no row, no words.
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(KIND_LABELS.length - 1));
    expect(switchLabels()).toEqual(KIND_LABELS.filter((label) => label !== NEW_TASK));
    expect(screen.queryByText(NEW_TASK, { includeHiddenElements: true })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Утренняя сводка' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Новая уборка' })).toBeChecked();
  },
);

test('a switch sends the value she wants', async () => {
  // Arrange
  setPreference.mockResolvedValue({ profile_id: ME, muted: ['cleaning_new', 'daily_digest'] });
  await renderScreen();
  const newCleaning = await screen.findByRole('switch', { name: 'Новая уборка' });

  // Act: the whole row is the switch.
  await fireEvent.press(newCleaning);

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

  // Act: the whole row is the switch.
  await fireEvent.press(digest);

  // Assert
  expect(await screen.findByText('Выбор не сохранился.')).toBeTruthy();
  expect(screen.getByText('Only an active person can change her pushes')).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Утренняя сводка' })).not.toBeChecked();
});

test('offers every language the app speaks, each named in itself', async () => {
  await renderScreen();

  // The language row only: the theme row below it is a radio group too.
  const names = within(screen.getByLabelText('Язык'))
    .getAllByRole('radio')
    .map((element) => element.props.accessibilityLabel);

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
