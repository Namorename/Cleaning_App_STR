import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { MIN_TOUCH_TARGET } from '@/constants/theme';

import { SegmentedTabs } from '../segmented-tabs';

/**
 * A row of two to four choices side by side: the theme, a filter. The chosen
 * one stands out by its frame and weight, not by its colour alone.
 */

const THEMES = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
] as const;

function boxOf(role: 'radio' | 'tab', name: string): ViewStyle {
  return StyleSheet.flatten(screen.getByRole(role, { name }).props.style) as ViewStyle;
}

test('as a choice: a radio group, the chosen one checked', async () => {
  await render(
    <SegmentedTabs
      semantics="radio"
      accessibilityLabel="Тема"
      options={THEMES}
      value="light"
      onChange={jest.fn()}
    />,
  );

  // The row is named, not focusable: grouping it would hide its choices from VoiceOver.
  expect(screen.getByLabelText('Тема').props.accessibilityRole).toBe('radiogroup');
  expect(screen.getByRole('radio', { name: 'Светлая' }).props.accessibilityState).toMatchObject({
    selected: true,
    checked: true,
  });
  expect(screen.getByRole('radio', { name: 'Тёмная' }).props.accessibilityState).toMatchObject({
    selected: false,
    checked: false,
  });
});

test('as tabs: a tab list, the current tab selected', async () => {
  await render(
    <SegmentedTabs accessibilityLabel="Тема" options={THEMES} value="dark" onChange={jest.fn()} />,
  );

  expect(screen.getByLabelText('Тема').props.accessibilityRole).toBe('tablist');
  expect(screen.getByRole('tab', { name: 'Тёмная' }).props.accessibilityState).toMatchObject({
    selected: true,
  });
});

test('a tap on another choice hands over its value; the current one does nothing', async () => {
  const onChange = jest.fn();
  await render(
    <SegmentedTabs
      semantics="radio"
      accessibilityLabel="Тема"
      options={THEMES}
      value="light"
      onChange={onChange}
    />,
  );

  await fireEvent.press(screen.getByRole('radio', { name: 'Светлая' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Как в системе' }));

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('system');
});

test('every choice is a full touch target', async () => {
  await render(
    <SegmentedTabs
      semantics="radio"
      accessibilityLabel="Тема"
      options={THEMES}
      value="light"
      onChange={jest.fn()}
    />,
  );

  for (const option of THEMES) {
    expect(boxOf('radio', option.label).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  }
});

test('the chosen one carries a frame the others do not: a cue beyond colour', async () => {
  await render(
    <SegmentedTabs
      semantics="radio"
      accessibilityLabel="Тема"
      options={THEMES}
      value="light"
      onChange={jest.fn()}
    />,
  );

  expect(boxOf('radio', 'Светлая').borderWidth).toBeGreaterThan(0);
  expect(boxOf('radio', 'Тёмная').borderWidth ?? 0).toBe(0);
});

test('disabled: no choice can be made, and each says so', async () => {
  const onChange = jest.fn();
  await render(
    <SegmentedTabs
      semantics="radio"
      accessibilityLabel="Тема"
      options={THEMES}
      value="light"
      onChange={onChange}
      isDisabled
    />,
  );

  await fireEvent.press(screen.getByRole('radio', { name: 'Тёмная' }));

  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('radio', { name: 'Тёмная' }).props.accessibilityState).toMatchObject({
    disabled: true,
  });
});
