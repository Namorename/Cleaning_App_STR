import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PasswordSection } from '../password-section';

/**
 * Changing her password while signed in: online only, checked on the phone
 * before anything is sent, and every refusal said as a sentence she can act
 * on. Tests read Russian: that is the language jest.setup fixes for the app.
 */

const mockSignInWithPassword = jest.fn();
const mockUpdateUser = jest.fn();
const mockSignOut = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  },
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    session: { user: { email: 'maria@test.local' } },
  }),
}));

const OK = { data: {}, error: null };

async function renderSection(): Promise<void> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <PasswordSection />
    </QueryClientProvider>,
  );
}

/** Types the three fields and presses the button. */
async function submit(current: string, next: string, repeat: string): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText('Текущий пароль'), current);
  await fireEvent.changeText(screen.getByLabelText('Новый пароль'), next);
  await fireEvent.changeText(screen.getByLabelText('Новый пароль ещё раз'), repeat);
  await fireEvent.press(screen.getByRole('button', { name: 'Сменить пароль' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignInWithPassword.mockResolvedValue(OK);
  mockUpdateUser.mockResolvedValue(OK);
  mockSignOut.mockResolvedValue({ error: null });
});

test('an empty field is caught before anything is sent', async () => {
  await renderSection();

  await submit('old-secret', 'new-secret', '');

  expect(screen.getByText('Заполните все три поля.')).toBeTruthy();
  expect(mockSignInWithPassword).not.toHaveBeenCalled();
});

test('a repeat that does not match is caught before anything is sent', async () => {
  await renderSection();

  await submit('old-secret', 'new-secret', 'new-secreT');

  expect(screen.getByText('Новые пароли не совпадают.')).toBeTruthy();
  expect(mockSignInWithPassword).not.toHaveBeenCalled();
});

test('a new password that is too short is caught before anything is sent', async () => {
  await renderSection();

  await submit('old-secret', '12345', '12345');

  expect(screen.getByText('Новый пароль должен быть не короче 6 символов.')).toBeTruthy();
  expect(mockSignInWithPassword).not.toHaveBeenCalled();
});

test('a wrong current password is said as such, and nothing changes', async () => {
  // Arrange
  mockSignInWithPassword.mockResolvedValue({
    data: {},
    error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
  });
  await renderSection();

  // Act
  await submit('guess', 'new-secret', 'new-secret');

  // Assert
  expect(await screen.findByText('Текущий пароль неверный.')).toBeTruthy();
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(mockSignOut).not.toHaveBeenCalled();
});

test('a password the server finds weak asks for another one', async () => {
  mockUpdateUser.mockResolvedValue({
    data: {},
    error: { code: 'weak_password', status: 422, message: 'Password is known to be weak' },
  });
  await renderSection();

  await submit('old-secret', 'password', 'password');

  expect(await screen.findByText('Пароль слишком простой. Придумайте другой.')).toBeTruthy();
  expect(mockSignOut).not.toHaveBeenCalled();
});

test('without a network it says a network is needed', async () => {
  mockSignInWithPassword.mockResolvedValue({
    data: {},
    error: { name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' },
  });
  await renderSection();

  await submit('old-secret', 'new-secret', 'new-secret');

  expect(
    await screen.findByText('Для смены пароля нужна сеть. Проверьте интернет и попробуйте снова.'),
  ).toBeTruthy();
});

test('an unknown refusal shows the general sentence with the server words under it', async () => {
  mockUpdateUser.mockResolvedValue({
    data: {},
    error: { code: 'unexpected_failure', status: 500, message: 'Database error updating user' },
  });
  await renderSection();

  await submit('old-secret', 'new-secret', 'new-secret');

  expect(
    await screen.findByText('Не удалось выполнить действие. Попробуйте ещё раз.'),
  ).toBeTruthy();
  expect(screen.getByText('Database error updating user')).toBeTruthy();
});

test('a changed password clears the form and says the other devices are signed out', async () => {
  // Arrange
  await renderSection();

  // Act
  await submit('old-secret', 'new-secret', 'new-secret');

  // Assert
  expect(
    await screen.findByText('Пароль изменён. На других устройствах нужно будет войти заново.'),
  ).toBeTruthy();
  expect(mockSignInWithPassword).toHaveBeenCalledWith({
    email: 'maria@test.local',
    password: 'old-secret',
  });
  expect(mockUpdateUser).toHaveBeenCalledWith({
    password: 'new-secret',
    current_password: 'old-secret',
  });
  // Auth itself closes every other session with the change.
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Текущий пароль').props.value).toBe('');
  expect(screen.getByLabelText('Новый пароль').props.value).toBe('');
  expect(screen.getByLabelText('Новый пароль ещё раз').props.value).toBe('');
});

test('a sign-in the server wants confirmed again asks for one more tap, not a code by e-mail', async () => {
  // "Secure password change" on in the cloud, and a refresh raced the fresh
  // sign-in: there is no mail to send a code with, and a second tap succeeds.
  mockUpdateUser.mockResolvedValue({
    data: {},
    error: {
      code: 'reauthentication_needed',
      status: 400,
      message: 'Password update requires reauthentication',
    },
  });
  await renderSection();

  await submit('old-secret', 'new-secret', 'new-secret');

  expect(
    await screen.findByText('Вход нужно подтвердить заново. Нажмите «Сменить пароль» ещё раз.'),
  ).toBeTruthy();
  expect(screen.queryByText('Password update requires reauthentication')).toBeNull();
});
