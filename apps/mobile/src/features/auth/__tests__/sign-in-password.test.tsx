import * as Sentry from '@sentry/react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SignInScreen from '@/app/sign-in';
import { signIn } from '@/features/auth/session';

jest.mock('expo-router', () => ({ Redirect: () => null }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: null }),
  signIn: jest.fn(async () => {}),
}));

const password = () => screen.getByLabelText('Пароль');

test('the password she typed can be shown and hidden again', async () => {
  // Arrange
  await render(<SignInScreen />);
  expect(password().props.secureTextEntry).toBe(true);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Показать пароль' }));

  // Assert
  expect(password().props.secureTextEntry).toBe(false);

  await fireEvent.press(screen.getByRole('button', { name: 'Скрыть пароль' }));

  expect(password().props.secureTextEntry).toBe(true);
});

test('a shown password signs in exactly as a hidden one', async () => {
  // Arrange
  await render(<SignInScreen />);
  await fireEvent.changeText(screen.getByLabelText('Почта'), 'anna@example.cz ');
  await fireEvent.changeText(password(), 'Kx7mQ2pL9vRt ');
  await fireEvent.press(screen.getByRole('button', { name: 'Показать пароль' }));

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

  // Assert
  await waitFor(() => expect(signIn).toHaveBeenCalledWith('anna@example.cz', 'Kx7mQ2pL9vRt'));
});

describe('the address as a reviewer types it (App Review rejection of 2026-10-13)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('the address is not corrected or spell-checked as it is typed', async () => {
    await render(<SignInScreen />);

    const email = screen.getByLabelText('Почта');
    expect(email.props.autoCorrect).toBe(false);
    expect(email.props.spellCheck).toBe(false);
  });

  test('the address goes in lower case, without the spaces around it', async () => {
    // Arrange
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Почта'), ' Anna@Example.CZ ');
    await fireEvent.changeText(password(), 'Kx7mQ2pL9vRt');

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    // Assert
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('anna@example.cz', 'Kx7mQ2pL9vRt'));
  });

  test('a refused sign-in is reported by its code and status, and by nothing typed', async () => {
    // Arrange
    jest.mocked(signIn).mockRejectedValueOnce({
      name: 'AuthApiError',
      code: 'invalid_credentials',
      status: 400,
      message: 'Invalid login credentials',
    });
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Почта'), 'anna@example.cz');
    await fireEvent.changeText(password(), 'Kx7mQ2pL9vRt');

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    // Assert
    await waitFor(() =>
      expect(Sentry.captureMessage).toHaveBeenCalledWith('Sign-in refused', {
        level: 'info',
        tags: { code: 'invalid_credentials', status: '400' },
      }),
    );
    const sent = JSON.stringify(jest.mocked(Sentry.captureMessage).mock.calls);
    expect(sent).not.toContain('anna');
    expect(sent).not.toContain('Kx7mQ2pL9vRt');
    expect(sent).not.toContain('Invalid login credentials');
  });

  test('a sign-in that goes through reports nothing', async () => {
    // Arrange
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Почта'), 'anna@example.cz');
    await fireEvent.changeText(password(), 'Kx7mQ2pL9vRt');

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    // Assert
    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
