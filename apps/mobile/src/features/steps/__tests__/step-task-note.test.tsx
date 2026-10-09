import { TOUCH_TARGET } from '@str-ops/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { StepTaskNote } from '../step-task-note';

/**
 * The manager's note, a line per tick: read at the door with a bag in the
 * other hand, so each line is a checkbox a finger can hit, and the index of a
 * line is what goes to the server.
 */

const lines = ['Проверить бойлер', 'Полить цветы'];
const onToggle = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

test('every line is a checkbox a finger can hit, saying whether it is ticked', async () => {
  await render(<StepTaskNote lines={lines} checked={[1]} onToggle={onToggle} disabled={false} />);

  const boxes = screen.getAllByRole('checkbox');
  expect(boxes).toHaveLength(2);
  for (const box of boxes) {
    const row = StyleSheet.flatten(box.props.style) as ViewStyle;
    expect(row.minHeight).toBeGreaterThanOrEqual(TOUCH_TARGET.phoneMin);
  }
  expect(screen.getByRole('checkbox', { name: 'Проверить бойлер', checked: false })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Полить цветы', checked: true })).toBeTruthy();
});

test('reports the index of the line that was tapped', async () => {
  await render(<StepTaskNote lines={lines} checked={[]} onToggle={onToggle} disabled={false} />);

  await fireEvent.press(screen.getByRole('checkbox', { name: 'Полить цветы' }));

  expect(onToggle).toHaveBeenCalledWith(1);
});

test('accepts no taps while the step is read-only', async () => {
  await render(<StepTaskNote lines={lines} checked={[]} onToggle={onToggle} disabled />);

  await fireEvent.press(screen.getByRole('checkbox', { name: 'Проверить бойлер' }));

  expect(onToggle).not.toHaveBeenCalled();
});

test('a ticked line carries the check icon, an open one an empty box', async () => {
  await render(<StepTaskNote lines={lines} checked={[1]} onToggle={onToggle} disabled={false} />);

  const ticked = screen.getByRole('checkbox', { name: 'Полить цветы' });
  expect(within(ticked).getByTestId('check-tick', { includeHiddenElements: true })).toBeTruthy();
  const open = screen.getByRole('checkbox', { name: 'Проверить бойлер' });
  expect(within(open).queryByTestId('check-tick', { includeHiddenElements: true })).toBeNull();
});
