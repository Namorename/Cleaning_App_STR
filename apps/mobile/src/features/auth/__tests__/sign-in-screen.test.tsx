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
