import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';

import { Colors, MIN_TOUCH_TARGET } from '@/constants/theme';

import { PasswordInput } from '../password-input';

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

describe('the eye, on the «Абрикос» components', () => {
  /** The Lucide drawings inside the eye's button, by their canonical names. */
  function glyphsIn(name: string, glyph: string): number {
    return screen
      .getByRole('button', { name })
      .queryAll((node) => String(node.props.className ?? '').includes(`lucide-${glyph}`)).length;
  }

  test('an open eye while the password is hidden, a struck one while it is shown', async () => {
    // Arrange
    await render(<PasswordInput accessibilityLabel="Пароль" value="" />);
    expect(glyphsIn('Показать пароль', 'eye')).toBeGreaterThan(0);
    expect(glyphsIn('Показать пароль', 'eye-off')).toBe(0);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Показать пароль' }));

    // Assert
    expect(glyphsIn('Скрыть пароль', 'eye-off')).toBeGreaterThan(0);
  });

  test('is a 48 dp target at the field’s end, drawn in the secondary text colour', async () => {
    await render(<PasswordInput accessibilityLabel="Пароль" value="" />);

    const eye = screen.getByRole('button', { name: 'Показать пароль' });
    expect(StyleSheet.flatten(eye.props.style)).toMatchObject({
      width: MIN_TOUCH_TARGET,
      right: 0,
    });
    const [drawing] = eye.queryAll((node) =>
      String(node.props.className ?? '').includes('lucide-eye'),
    );
    expect(drawing?.props.stroke).toBe(Colors.light.textSecondary);
  });
});
