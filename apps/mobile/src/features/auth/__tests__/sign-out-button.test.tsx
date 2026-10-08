import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, StyleSheet, type AlertButton } from 'react-native';

import { BUTTON_HEIGHT, Colors } from '@/constants/theme';

import { signOut } from '../session';
import { SignOutButton } from '../sign-out-button';

jest.mock('../session', () => ({
  signOut: jest.fn(),
}));

const mockSignOut = jest.mocked(signOut);

/** The question she is asked first, and the button that confirms it. */
function confirmSignOut(alert: jest.SpyInstance): void {
  const buttons = alert.mock.calls[0][2] as AlertButton[];
  const confirm = buttons.find((button) => button.style === 'destructive');
  confirm?.onPress?.();
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('asks before leaving, and leaves once she confirms', async () => {
  // Arrange
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockSignOut.mockResolvedValue();
  await render(<SignOutButton />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Выйти' }));
  confirmSignOut(alert);

  // Assert
  expect(alert.mock.calls[0][0]).toBe('Выйти из аккаунта?');
  await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  expect(alert).toHaveBeenCalledTimes(1);
});

test('a failed sign-out is said in her language, with the raw words as a paragraph under it', async () => {
  // Arrange
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockSignOut.mockRejectedValue(new Error('Auth session missing!'));
  await render(<SignOutButton />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Выйти' }));
  confirmSignOut(alert);

  // Assert: never the server's English on its own.
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  expect(alert).toHaveBeenLastCalledWith(
    'Не удалось выйти',
    'Не удалось выполнить действие. Попробуйте ещё раз.\n\nAuth session missing!',
  );
});

test('is the 56 dp destructive button: the urgent tint, the label in danger', async () => {
  await render(<SignOutButton />);

  const button = StyleSheet.flatten(screen.getByRole('button', { name: 'Выйти' }).props.style);
  expect(button.minHeight).toBe(BUTTON_HEIGHT);
  expect(button.backgroundColor).toBe(Colors.light.tone.urgent.bg);
  expect(StyleSheet.flatten(screen.getByText('Выйти').props.style).color).toBe(Colors.light.danger);
});
