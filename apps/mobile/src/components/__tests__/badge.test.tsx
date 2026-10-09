import { TONE_COLORS } from '@str-ops/shared';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';

import { Badge } from '../badge';

/** A status as a chip: the tone of the contract, and always its word. */

const tones = TONE_COLORS.light;

function boxOf(testID: string): ViewStyle {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) as ViewStyle;
}

function inkOf(label: string): TextStyle {
  return StyleSheet.flatten(screen.getByText(label).props.style) as TextStyle;
}

test('says its word in the tone’s colours', async () => {
  await render(<Badge testID="chip" label="Выполнена" tone="done" />);

  expect(boxOf('chip').backgroundColor).toBe(tones.done.bg);
  expect(inkOf('Выполнена').color).toBe(tones.done.fg);
});

test('the unread badge is filled, its word on the mark', async () => {
  await render(<Badge testID="chip" label="Новое сообщение" tone="unread" />);

  expect(boxOf('chip').backgroundColor).toBe(tones.unread.mark);
  expect(inkOf('Новое сообщение').color).toBe(tones.unread.onMark);
});

test('«Без исполнителя» has a dashed frame, «Просрочено» a solid one: shape, not only colour', async () => {
  await render(
    <>
      <Badge testID="nobody" label="Без исполнителя" tone="unassigned" />
      <Badge testID="late" label="Просрочена" tone="overdue" />
    </>,
  );

  expect(boxOf('nobody')).toMatchObject({
    borderStyle: 'dashed',
    borderColor: tones.unassigned.border,
  });
  expect(boxOf('late')).toMatchObject({ borderStyle: 'solid', borderColor: tones.overdue.border });
});

test('a pill, never mistaken for a button', async () => {
  await render(<Badge testID="chip" label="В работе" tone="inProgress" />);

  expect(boxOf('chip').borderRadius).toBe(999);
  expect(screen.queryByRole('button')).toBeNull();
});

test('draws what it is given before the word, where the status icon will go', async () => {
  await render(<Badge label="Принята" tone="assigned" left={<Text>[✓]</Text>} />);

  expect(screen.getByText('[✓]')).toBeTruthy();
});
