import { THEME_COLORS, THEME_NAMES, TONE_COLORS, TOUCH_TARGET } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type ViewStyle } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

import { contrastRatio } from '../../../../../packages/shared/src/testing/color-math';
import { Button, type ButtonVariant } from '../button';

/**
 * The button the screens will share (5.4): today it is put together by hand
 * in eleven places. 56 dp for a gloved finger (owner's decision 5); the main
 * one in the sun-proof `cta` colours (decisions §3).
 */

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
const scheme = jest.mocked(useColorScheme);

const light = THEME_COLORS.light;
const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'outline', 'destructive'];
/** WCAG 2.2 1.4.11: a control the user has to find, against what is next to it. */
const NON_TEXT = 3;

beforeEach(() => {
  scheme.mockReturnValue('light');
});

function boxOf(name: string): ViewStyle {
  return StyleSheet.flatten(screen.getByRole('button', { name }).props.style) as ViewStyle;
}

/** What a box adds around its label: its frame and its padding, each side. */
function edgesOf(box: ViewStyle): { vertical: unknown; horizontal: unknown } {
  const frame = box.borderWidth ?? 0;
  return {
    vertical: frame + Number(box.paddingVertical ?? 0),
    horizontal: frame + Number(box.paddingHorizontal ?? 0),
  };
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

/**
 * The inactive fill alone is 1.04:1 against the light screen: the button
 * vanished (owner, 2026-10-09). Its frame is what she finds it by — 3:1
 * against the screen and against a card, in both themes, measured from the
 * tokens.
 */
describe.each(THEME_NAMES)('inactive, in the %s theme', (themeName) => {
  const colors = THEME_COLORS[themeName];

  test.each(VARIANTS)(
    '%s: its frame stands out 3:1 from the screen and from a card',
    async (variant) => {
      scheme.mockReturnValue(themeName);
      await render(<Button label="Завершить" variant={variant} isDisabled onPress={jest.fn()} />);

      const box = boxOf('Завершить');
      const frame = String(box.borderColor);

      expect(box.borderWidth).toBeGreaterThan(0);
      expect(contrastRatio(frame, colors.bg)).toBeGreaterThanOrEqual(NON_TEXT);
      expect(contrastRatio(frame, colors.surface)).toBeGreaterThanOrEqual(NON_TEXT);
    },
  );
});

// The frame comes out of the padding: a box that grows when the button turns
// active makes the screen jump under her finger.
test.each(VARIANTS)('%s: turning active, the box keeps its size', async (variant) => {
  await render(
    <>
      <Button label="Неактивная" variant={variant} isDisabled onPress={jest.fn()} />
      <Button label="Активная" variant={variant} onPress={jest.fn()} />
    </>,
  );

  const inactive = boxOf('Неактивная');
  const active = boxOf('Активная');

  expect(inactive.minHeight).toBe(TOUCH_TARGET.phoneButton);
  expect(active.minHeight).toBe(TOUCH_TARGET.phoneButton);
  expect(edgesOf(inactive)).toEqual(edgesOf(active));
});

test('busy is drawn as its own kind, not as inactive', async () => {
  await render(<Button label="Сохранить" isBusy onPress={jest.fn()} />);

  const box = boxOf('Сохранить');

  expect(box.backgroundColor).toBe(light.cta);
  expect(box.borderColor).toBeUndefined();
  expect(StyleSheet.flatten(screen.getByText('Сохранить').props.style).color).toBe(light.onCta);
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
