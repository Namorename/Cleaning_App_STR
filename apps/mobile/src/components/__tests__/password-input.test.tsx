import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { PasswordInput } from '../password-input';

// The icon is drawn by a native view on iOS and a font on Android; neither is
// what is tested here — the button around it is.
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));

afterEach(() => {
  jest.restoreAllMocks();
});

test('hides what is typed until the eye is pressed, then shows it, then hides it again', async () => {
  // Arrange
  await render(<PasswordInput accessibilityLabel="Пароль" value="Kx7mQ2pL9vRt" />);
  expect(screen.getByLabelText('Пароль').props.secureTextEntry).toBe(true);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Показать пароль' }));

  // Assert
  expect(screen.getByLabelText('Пароль').props.secureTextEntry).toBe(false);

  await fireEvent.press(screen.getByRole('button', { name: 'Скрыть пароль' }));

  expect(screen.getByLabelText('Пароль').props.secureTextEntry).toBe(true);
});

test('a shown password is still not corrected, capitalised or suggested', async () => {
  // Arrange
  await render(<PasswordInput accessibilityLabel="Пароль" value="" autoCapitalize="sentences" />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Показать пароль' }));

  // Assert
  const field = screen.getByLabelText('Пароль');
  expect(field.props.autoCorrect).toBe(false);
  expect(field.props.spellCheck).toBe(false);
  expect(field.props.autoCapitalize).toBe('none');
});

test('on Android a shown password tells the keyboard it is a password, so it is not learned', async () => {
  // Arrange
  jest.replaceProperty(Platform, 'OS', 'android');
  await render(<PasswordInput accessibilityLabel="Пароль" value="" />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Показать пароль' }));

  // Assert
  expect(screen.getByLabelText('Пароль').props.keyboardType).toBe('visible-password');
});

test('typing still reaches the screen that owns the field', async () => {
  // Arrange
  const onChangeText = jest.fn();
  await render(<PasswordInput accessibilityLabel="Пароль" value="" onChangeText={onChangeText} />);

  // Act
  await fireEvent.changeText(screen.getByLabelText('Пароль'), 'Kx7mQ2pL9vRt');

  // Assert
  expect(onChangeText).toHaveBeenCalledWith('Kx7mQ2pL9vRt');
});
