import { RADIUS, THEME_COLORS } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type ViewStyle } from 'react-native';

import { Card } from '../card';

/** A card: the surface, rounded 20, on a soft shadow instead of a frame. */

test('holds what it is given, on the surface colour, without a frame', async () => {
  await render(
    <Card testID="card">
      <Text>Nádražní 6</Text>
    </Card>,
  );

  const box = StyleSheet.flatten(screen.getByTestId('card').props.style) as ViewStyle;
  expect(screen.getByText('Nádražní 6')).toBeTruthy();
  expect(box.backgroundColor).toBe(THEME_COLORS.light.surface);
  expect(box.borderRadius).toBe(RADIUS.lg);
  expect(box.borderWidth ?? 0).toBe(0);
  expect(box.boxShadow).toBeTruthy();
});

test('with an action it is one button, named for the reader', async () => {
  const onPress = jest.fn();
  await render(
    <Card onPress={onPress} accessibilityLabel="Уборка: Nádražní 6, 10 ноября">
      <Text>Nádražní 6</Text>
    </Card>,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Уборка: Nádražní 6, 10 ноября' }));

  expect(onPress).toHaveBeenCalledTimes(1);
});

test('without an action it is no button at all', async () => {
  await render(
    <Card>
      <Text>Nádražní 6</Text>
    </Card>,
  );

  expect(screen.queryByRole('button')).toBeNull();
});
