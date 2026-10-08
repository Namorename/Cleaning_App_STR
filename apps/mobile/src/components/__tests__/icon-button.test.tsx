import { THEME_COLORS, TOUCH_TARGET } from '@str-ops/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { IconButton } from '../icon-button';

/**
 * A button that is only a picture: the chat's camera, gallery and send. It has
 * no words on it, so its name for the reader is required, and its target is
 * never smaller than a finger — 48 dp, or 56 for the screen's main move.
 */

const light = THEME_COLORS.light;

function boxOf(name: string): ViewStyle {
  return StyleSheet.flatten(screen.getByRole('button', { name }).props.style) as ViewStyle;
}

test('is a button named by its label, and presses', async () => {
  // Arrange
  const onPress = jest.fn();
  await render(<IconButton icon="action.send" accessibilityLabel="Отправить" onPress={onPress} />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

  // Assert
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('is a 48 dp round target, and 56 dp when it is the main move', async () => {
  await render(
    <>
      <IconButton icon="action.takePhoto" accessibilityLabel="Снять фото" onPress={jest.fn()} />
      <IconButton
        icon="action.send"
        size="large"
        accessibilityLabel="Отправить"
        onPress={jest.fn()}
      />
    </>,
  );

  expect(boxOf('Снять фото')).toMatchObject({
    width: TOUCH_TARGET.phoneMin,
    height: TOUCH_TARGET.phoneMin,
    borderRadius: 999,
  });
  expect(boxOf('Отправить')).toMatchObject({
    width: TOUCH_TARGET.phoneButton,
    height: TOUCH_TARGET.phoneButton,
  });
});

test('primary is filled with the sun-proof cta; plain has no fill', async () => {
  await render(
    <>
      <IconButton
        icon="action.send"
        variant="primary"
        accessibilityLabel="Отправить"
        onPress={jest.fn()}
      />
      <IconButton icon="action.takePhoto" accessibilityLabel="Снять фото" onPress={jest.fn()} />
    </>,
  );

  expect(boxOf('Отправить').backgroundColor).toBe(light.cta);
  expect(boxOf('Снять фото').backgroundColor).toBe('transparent');
});

test('disabled: says so, does not press, and a primary one is drawn quiet', async () => {
  // Arrange
  const onPress = jest.fn();
  await render(
    <IconButton
      icon="action.send"
      variant="primary"
      isDisabled
      accessibilityLabel="Отправить"
      onPress={onPress}
    />,
  );
  const button = screen.getByRole('button', { name: 'Отправить' });

  // Act
  await fireEvent.press(button);

  // Assert
  expect(onPress).not.toHaveBeenCalled();
  expect(button).toBeDisabled();
  expect(boxOf('Отправить').backgroundColor).toBe(light.surfaceAlt);
});

test('busy: says so, and a second tap does nothing', async () => {
  const onPress = jest.fn();
  await render(
    <IconButton icon="action.takePhoto" isBusy accessibilityLabel="Снять фото" onPress={onPress} />,
  );

  const button = screen.getByRole('button', { name: 'Снять фото' });
  await fireEvent.press(button);

  expect(onPress).not.toHaveBeenCalled();
  expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
});

test('carries a value for the reader, such as how many photos are chosen', async () => {
  await render(
    <IconButton
      icon="action.takePhoto"
      accessibilityLabel="Снять фото"
      accessibilityValue={{ text: '1 из 4' }}
      onPress={jest.fn()}
    />,
  );

  expect(screen.getByRole('button', { name: 'Снять фото' }).props.accessibilityValue).toEqual({
    text: '1 из 4',
  });
});
