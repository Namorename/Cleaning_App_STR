import {
  MIN_PASSWORD_LENGTH,
  changePassword,
  passwordDraftIssue,
  passwordFailureText,
} from '../password';

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

const EMAIL = 'maria@test.local';
const OK = { data: {}, error: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockSignInWithPassword.mockResolvedValue(OK);
  mockUpdateUser.mockResolvedValue(OK);
  mockSignOut.mockResolvedValue({ error: null });
});

describe('what is checked before anything is sent', () => {
  const draft = { current: 'old-secret', next: 'new-secret', repeat: 'new-secret' };

  test('a complete, matching, new and long enough password passes', () => {
    expect(passwordDraftIssue(draft)).toBeNull();
  });

  test('every field has to be filled', () => {
    expect(passwordDraftIssue({ ...draft, current: '' })).toBe('fillAll');
    expect(passwordDraftIssue({ ...draft, repeat: '   ' })).toBe('fillAll');
  });

  test('the repeat has to match', () => {
    expect(passwordDraftIssue({ ...draft, repeat: 'new-secreT' })).toBe('mismatch');
  });

  test('the new password has to differ from the current one', () => {
    expect(passwordDraftIssue({ current: 'same-one', next: 'same-one', repeat: 'same-one' })).toBe(
      'sameAsCurrent',
    );
  });

  test('the new password is at least as long as the server asks', () => {
    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);

    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(passwordDraftIssue({ ...draft, next: short, repeat: short })).toBe('tooShort');
  });

  // The sign-in screen trims what she types (a password pasted with a trailing
  // space), so a new password is judged the way she will type it later.
  test('spaces around a password do not count', () => {
    expect(passwordDraftIssue({ ...draft, next: ' new-secret ', repeat: 'new-secret' })).toBeNull();
    expect(passwordDraftIssue({ ...draft, next: '  12345 ', repeat: '12345' })).toBe('tooShort');
  });
});

describe('changePassword', () => {
  test('checks the current password, then sets the new one on the fresh sign-in', async () => {
    // Act
    await changePassword({ email: EMAIL, current: 'old-secret', next: 'new-secret' });

    // Assert
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: 'old-secret' });
    expect(mockUpdateUser).toHaveBeenCalledWith({
      password: 'new-secret',
      current_password: 'old-secret',
    });
    expect(mockSignInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateUser.mock.invocationCallOrder[0],
    );
  });

  // Auth closes every other session itself when the password changes
  // (LogoutAllExceptMe in UpdatePassword, supabase/auth v2.197.0
  // internal/models/user.go#L459-L462; seen on a local GoTrue: two sessions
  // before, one after). A sign-out of our own on top of it could only fail
  // and report other devices still in that are not.
  test('leaves closing the other sign-ins to the server, which does it with the change', async () => {
    await changePassword({ email: EMAIL, current: 'old-secret', next: 'new-secret' });

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test('sends the passwords the way the sign-in screen will read them, trimmed', async () => {
    await changePassword({ email: EMAIL, current: ' old-secret ', next: 'new-secret ' });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: 'old-secret' });
    expect(mockUpdateUser).toHaveBeenCalledWith({
      password: 'new-secret',
      current_password: 'old-secret',
    });
  });

  test('a wrong current password stops before anything changes', async () => {
    // Arrange
    const wrong = {
      code: 'invalid_credentials',
      status: 400,
      message: 'Invalid login credentials',
    };
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: wrong });

    // Act + Assert
    await expect(
      changePassword({ email: EMAIL, current: 'guess', next: 'new-secret' }),
    ).rejects.toBe(wrong);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test('a refused new password is passed on as it came', async () => {
    const weak = { code: 'weak_password', status: 422, message: 'Password is known to be weak' };
    mockUpdateUser.mockResolvedValue({ data: {}, error: weak });

    await expect(
      changePassword({ email: EMAIL, current: 'old-secret', next: 'password' }),
    ).rejects.toBe(weak);
  });
});

describe('passwordFailureText', () => {
  // Tests read Russian: that is the language jest.setup fixes for the app.
  test.each([
    [{ code: 'invalid_credentials', status: 400 }, 'Текущий пароль неверный.'],
    [{ code: 'weak_password', status: 422 }, 'Пароль слишком простой. Придумайте другой.'],
    [{ code: 'same_password', status: 422 }, 'Новый пароль совпадает с текущим.'],
    [
      { code: 'over_request_rate_limit', status: 429 },
      'Слишком много попыток. Попробуйте через минуту.',
    ],
    [{ status: 429 }, 'Слишком много попыток. Попробуйте через минуту.'],
    [
      { name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' },
      'Для смены пароля нужна сеть. Проверьте интернет и попробуйте снова.',
    ],
    // "Secure password change" on, and the session updateUser saw was more
    // than a day old: only a refresh racing the fresh sign-in gets here, and a
    // second tap goes through (experiment on GoTrue v2.195.0, flag on).
    [
      { code: 'reauthentication_needed', status: 400 },
      'Вход нужно подтвердить заново. Нажмите «Сменить пароль» ещё раз.',
    ],
    // The separate "require current password" setting (GoTrue v2.190+): the
    // current password travels with the change, and a wrong one is said so.
    [{ code: 'current_password_invalid', status: 400 }, 'Текущий пароль неверный.'],
    [{ code: 'current_password_required', status: 400 }, 'Текущий пароль неверный.'],
  ])('%o reads as a sentence of its own', (failure, text) => {
    expect(passwordFailureText(failure)).toEqual({ text, detail: null });
  });

  test('anything else is the general sentence with the server words small under it', () => {
    expect(
      passwordFailureText({
        code: 'unexpected_failure',
        status: 500,
        message: 'Database error updating user',
      }),
    ).toEqual({
      text: 'Не удалось выполнить действие. Попробуйте ещё раз.',
      detail: 'Database error updating user',
    });
  });
});
