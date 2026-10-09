import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { Colors, FontSize, MIN_TOUCH_TARGET } from '@/constants/theme';

import { PushNotice } from '../push-notice';

/**
 * Why a tap on a push landed on her list rather than on the cleaning. Said
 * once, in words, in the urgent tone, and gone when she has read it.
 */

const light = Colors.light;

function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
}

test('says what happened, and «Скрыть» dismisses it', async () => {
  // Arrange
  const onDismiss = jest.fn();
  await render(<PushNotice notice="cancelled" onDismiss={onDismiss} />);
  expect(screen.getByText('Эту уборку отменили.')).toBeTruthy();

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Скрыть' }));

  // Assert
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

describe('on the «Абрикос» components', () => {
  test('the words are body text in the urgent tone’s ink', async () => {
    await render(<PushNotice notice="unassigned" onDismiss={jest.fn()} />);

    const words = styleOf(screen.getByText('Эту уборку с вас сняли.'));
    expect(words.color).toBe(light.tone.urgent.fg);
    expect(words.fontSize).toBe(FontSize.body);
  });

  test('«Скрыть» is Lucide’s close on a 48 dp round target', async () => {
    await render(<PushNotice notice="movedAway" onDismiss={jest.fn()} />);

    const dismiss = screen.getByRole('button', { name: 'Скрыть' });
    expect(styleOf(dismiss)).toMatchObject({
      width: MIN_TOUCH_TARGET,
      height: MIN_TOUCH_TARGET,
    });
    const close = dismiss.queryAll((node) =>
      String(node.props.className ?? '').includes('lucide-x'),
    );
    expect(close.length).toBeGreaterThan(0);
  });
});
