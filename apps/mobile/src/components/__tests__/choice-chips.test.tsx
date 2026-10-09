import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { MIN_TOUCH_TARGET } from '@/constants/theme';

import { ChoiceChips } from '../choice-chips';

/**
 * More choices than a segmented row holds (it takes two to four): a row of
 * pills that scrolls sideways instead of squeezing at 320 dp and a large font.
 */

const OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'open', label: 'Открыто' },
  { value: 'assigned', label: 'Назначено' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Выполнено' },
  { value: 'archived', label: 'Архив' },
] as const;

test('every choice is a tab of the named row, the chosen one said as selected', async () => {
  await render(
    <ChoiceChips options={OPTIONS} value="open" onChange={jest.fn()} accessibilityLabel="Статус" />,
  );

  // Named, not focusable: grouping the row would hide its choices from VoiceOver.
  expect(screen.getByLabelText('Статус').props.accessibilityRole).toBe('tablist');
  expect(screen.getAllByRole('tab')).toHaveLength(OPTIONS.length);
  expect(screen.getByRole('tab', { name: 'Открыто' }).props.accessibilityState).toMatchObject({
    selected: true,
  });
  expect(screen.getByRole('tab', { name: 'Все' }).props.accessibilityState).toMatchObject({
    selected: false,
  });
});

test('a press on another choice picks it; a press on the chosen one does nothing', async () => {
  const onChange = jest.fn();
  await render(
    <ChoiceChips options={OPTIONS} value="open" onChange={onChange} accessibilityLabel="Статус" />,
  );

  await fireEvent.press(screen.getByRole('tab', { name: 'Архив' }));
  await fireEvent.press(screen.getByRole('tab', { name: 'Открыто' }));

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('archived');
});

test('as a setting, the row is a radio group', async () => {
  await render(
    <ChoiceChips
      options={OPTIONS}
      value="all"
      onChange={jest.fn()}
      accessibilityLabel="День"
      semantics="radio"
    />,
  );

  expect(screen.getByLabelText('День').props.accessibilityRole).toBe('radiogroup');
  expect(screen.getByRole('radio', { name: 'Все' }).props.accessibilityState).toMatchObject({
    checked: true,
  });
});

test('each choice is a full touch target, and the row scrolls sideways', async () => {
  await render(
    <ChoiceChips options={OPTIONS} value="all" onChange={jest.fn()} accessibilityLabel="Статус" />,
  );

  for (const chip of screen.getAllByRole('tab')) {
    expect((StyleSheet.flatten(chip.props.style) as ViewStyle).minHeight).toBe(MIN_TOUCH_TARGET);
  }
  const [row] = screen.container.queryAll((node) => node.type === 'RCTScrollView');
  expect(row.props.horizontal).toBe(true);
});
