import { THEME_COLORS } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { BUTTON_HEIGHT, MIN_TOUCH_TARGET } from '@/constants/theme';

import { TextField } from '../text-field';

/** A field she types into: its name above, a hint or the error below it. */

const light = THEME_COLORS.light;

function inputStyle(label: string): TextStyle {
  return StyleSheet.flatten(screen.getByLabelText(label).props.style) as TextStyle;
}

test('the field is found by its visible label, and takes what she types', async () => {
  const onChangeText = jest.fn();
  await render(<TextField label="Название" value="" onChangeText={onChangeText} />);

  expect(screen.getByText('Название')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Название'), 'Течёт кран');

  expect(onChangeText).toHaveBeenCalledWith('Течёт кран');
});

test('is at least a touch target high, with an outline she can find', async () => {
  await render(<TextField label="Название" value="" onChangeText={jest.fn()} />);

  const style = inputStyle('Название');
  expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  expect(style.borderColor).toBe(light.border);
});

test('shows the hint while there is no error', async () => {
  await render(
    <TextField label="Пароль" hint="Не короче 8 символов" value="" onChangeText={jest.fn()} />,
  );

  expect(screen.getByText('Не короче 8 символов')).toBeTruthy();
});

test('an error replaces the hint, is announced, and frames the field in danger', async () => {
  await render(
    <TextField
      label="Пароль"
      hint="Не короче 8 символов"
      error="Пароль слишком простой"
      value="1234"
      onChangeText={jest.fn()}
    />,
  );

  expect(screen.queryByText('Не короче 8 символов')).toBeNull();
  const error = screen.getByText('Пароль слишком простой');
  expect(error.props.accessibilityLiveRegion).toBe('polite');
  expect(inputStyle('Пароль').borderColor).toBe(light.danger);
});

test('focus shows as the focus ring', async () => {
  await render(<TextField label="Название" value="" onChangeText={jest.fn()} />);

  await fireEvent(screen.getByLabelText('Название'), 'focus');

  expect(inputStyle('Название').borderColor).toBe(light.focusRing);
});

// The details of a report: a few sentences, so the box shows a few lines and
// the text starts at its top, not in the middle of it (Android's default).
test('a field of several lines is taller, and is written from the top', async () => {
  await render(<TextField label="Подробности" value="" onChangeText={jest.fn()} multiline />);

  const style = inputStyle('Подробности');
  expect(style.minHeight).toBeGreaterThan(BUTTON_HEIGHT);
  expect(style.textAlignVertical).toBe('top');
});

test('a field of one line keeps the button height', async () => {
  await render(<TextField label="Название" value="" onChangeText={jest.fn()} />);

  expect(inputStyle('Название').minHeight).toBe(BUTTON_HEIGHT);
});

// A field under each line of a supply request: the eye reads «Уточнение»
// under the line's name, the reader has to hear which line it belongs to.
test('a label of its own for the reader, when the visible one leans on what is above it', async () => {
  await render(
    <TextField
      label="Уточнение"
      accessibilityLabel="Мешки для мусора: уточнение"
      value=""
      onChangeText={jest.fn()}
    />,
  );

  expect(screen.getByText('Уточнение')).toBeTruthy();
  expect(screen.getByLabelText('Мешки для мусора: уточнение')).toBeTruthy();
  expect(screen.queryByLabelText('Уточнение')).toBeNull();
});

test('disabled: not editable, and says so', async () => {
  await render(<TextField label="Название" value="Кран" isDisabled onChangeText={jest.fn()} />);

  const input = screen.getByLabelText('Название');
  expect(input.props.editable).toBe(false);
  expect(input.props.accessibilityState).toMatchObject({ disabled: true });
});
