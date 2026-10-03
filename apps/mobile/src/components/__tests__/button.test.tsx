import { THEME_COLORS, TONE_COLORS, TOUCH_TARGET } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type ViewStyle } from 'react-native';

import { Button } from '../button';

/**
 * The button the screens will share (5.4): today it is put together by hand
 * in eleven places. 56 dp for a gloved finger (owner's decision 5); the main
 * one in the sun-proof `cta` colours (decisions §3).
 */

const light = THEME_COLORS.light;

function boxOf(name: string): ViewStyle {
  return StyleSheet.flatten(screen.getByRole('button', { name }).props.style) as ViewStyle;
}

test('is a button named by its label, and presses', async () => {
  const onPress = jest.fn();
  await render(<Button label="Начать уборку" onPress={onPress} />);

  await fireEvent.press(screen.getByRole('button', { name: 'Начать уборку' }));

  expect(onPress).toHaveBeenCalledTimes(1);
});

test('is 56 dp high, a pill', async () => {
  await render(<Button label="Начать уборку" onPress={jest.fn()} />);

  const box = boxOf('Начать уборку');
  expect(box.minHeight).toBe(TOUCH_TARGET.phoneButton);
  expect(box.borderRadius).toBe(999);
});

test.each([
  ['primary', light.cta, light.onCta],
  ['secondary', light.secondary, light.onSecondary],
  ['destructive', TONE_COLORS.light.urgent.bg, light.danger],
] as const)('%s: its fill and label', async (variant, fill, ink) => {
  await render(<Button label="Действие" variant={variant} onPress={jest.fn()} />);

  expect(boxOf('Действие').backgroundColor).toBe(fill);
  expect(StyleSheet.flatten(screen.getByText('Действие').props.style).color).toBe(ink);
});

test('outline: a frame in the primary colour, nothing filled', async () => {
  await render(<Button label="Сообщить" variant="outline" onPress={jest.fn()} />);

  const box = boxOf('Сообщить');
  expect(box.borderColor).toBe(light.primary);
  expect(box.backgroundColor).toBe('transparent');
});

test('disabled: says so, does not press, and is drawn quiet', async () => {
  const onPress = jest.fn();
  await render(<Button label="Завершить" isDisabled onPress={onPress} />);

  const button = screen.getByRole('button', { name: 'Завершить' });
  await fireEvent.press(button);

  expect(onPress).not.toHaveBeenCalled();
  expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  expect(boxOf('Завершить').backgroundColor).toBe(light.surfaceAlt);
});

test('busy: says so, keeps its label, and a second tap does nothing', async () => {
  const onPress = jest.fn();
  await render(<Button label="Сохранить" isBusy onPress={onPress} />);

  const button = screen.getByRole('button', { name: 'Сохранить' });
  await fireEvent.press(button);

  expect(onPress).not.toHaveBeenCalled();
  expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  expect(screen.getByText('Сохранить')).toBeTruthy();
});

test('a label of its own for the reader, when the visible one is not enough', async () => {
  await render(
    <Button label="Взять" accessibilityLabel="Взять уборку: Nádražní 6" onPress={jest.fn()} />,
  );

  expect(screen.getByRole('button', { name: 'Взять уборку: Nádražní 6' })).toBeTruthy();
});

test('draws what it is given beside the label, where an icon will go', async () => {
  await render(<Button label="Фото" left={<Text>[icon]</Text>} onPress={jest.fn()} />);

  expect(screen.getByText('[icon]')).toBeTruthy();
});
