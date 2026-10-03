import { TOUCH_TARGET } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type ViewStyle } from 'react-native';

import { ListRow } from '../list-row';

/** A row of a list: 64 dp, a title and a quieter line under it. */

test('a row with an action is a button named by both its lines', async () => {
  const onPress = jest.fn();
  await render(
    <ListRow title="Лицензия шрифта" subtitle="Nunito, SIL OFL 1.1" onPress={onPress} />,
  );

  const row = screen.getByRole('button', { name: 'Лицензия шрифта, Nunito, SIL OFL 1.1' });
  await fireEvent.press(row);

  expect(onPress).toHaveBeenCalledTimes(1);
});

test('is 64 dp high', async () => {
  await render(<ListRow title="Язык" onPress={jest.fn()} />);

  const row = screen.getByRole('button', { name: 'Язык' });
  const box = StyleSheet.flatten(row.props.style) as ViewStyle;
  expect(box.minHeight).toBe(TOUCH_TARGET.phoneRow);
});

test('a row without an action is plain text, no button', async () => {
  await render(<ListRow title="Версия" subtitle="1.1.0" />);

  expect(screen.getByText('Версия')).toBeTruthy();
  expect(screen.getByText('1.1.0')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

test('says it is the chosen one', async () => {
  await render(<ListRow title="Тёмная" isSelected onPress={jest.fn()} />);

  expect(screen.getByRole('button', { name: 'Тёмная' }).props.accessibilityState).toMatchObject({
    selected: true,
  });
});

test('keeps a slot on each side, where an icon or a value will go', async () => {
  await render(<ListRow title="Тема" left={<Text>[icon]</Text>} right={<Text>Светлая</Text>} />);

  expect(screen.getByText('[icon]')).toBeTruthy();
  expect(screen.getByText('Светлая')).toBeTruthy();
});
