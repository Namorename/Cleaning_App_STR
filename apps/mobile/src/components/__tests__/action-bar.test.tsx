import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { BOTTOM_INSETS, withBottomInset } from '@/testing/insets';

import { ActionBar } from '../action-bar';

/**
 * The strip a screen's main button is pinned in, under what scrolls: «Создать
 * задание» under her reports, «Отправить» under the form. It sits below the
 * content rather than over it, so nothing scrolled to the end hides behind it.
 */

const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };

function barStyle(): ViewStyle {
  return StyleSheet.flatten(screen.getByTestId('bar').props.style) as ViewStyle;
}

test('holds what it is given, the screen margins either side', async () => {
  await render(
    <ActionBar testID="bar">
      <Text>Отправить</Text>
    </ActionBar>,
  );

  expect(screen.getByText('Отправить')).toBeTruthy();
  expect(barStyle().paddingHorizontal).toBe(Spacing.lg);
});

test('below the content, not laid over it', async () => {
  await render(
    <ActionBar testID="bar">
      <Text>Отправить</Text>
    </ActionBar>,
  );

  expect(barStyle().position).toBeUndefined();
});

test('on the bottom edge of the screen it clears the home indicator', async () => {
  await render(
    <SafeAreaInsetsContext.Provider value={INSETS}>
      <ActionBar testID="bar" isAtScreenEdge>
        <Text>Отправить</Text>
      </ActionBar>
    </SafeAreaInsetsContext.Provider>,
  );

  expect(barStyle().paddingBottom).toBe(Spacing.md + INSETS.bottom);
});

test('above the tab bar it does not: the tab bar has already cleared it', async () => {
  await render(
    <SafeAreaInsetsContext.Provider value={INSETS}>
      <ActionBar testID="bar">
        <Text>Создать задание</Text>
      </ActionBar>
    </SafeAreaInsetsContext.Provider>,
  );

  expect(barStyle().paddingBottom).toBe(Spacing.md);
});

// Block 3 (2026-10-10): on Android the three-button navigation bar (48 dp) or
// the gesture bar lies over the bottom of the screen; a form's button must
// stand clear of it, with its own margin above it.
describe.each(BOTTOM_INSETS)('with a bottom inset of %i dp', (bottom) => {
  test('on the screen’s edge it rises by the inset over its own margin', async () => {
    await render(
      withBottomInset(
        bottom,
        <ActionBar testID="bar" isAtScreenEdge>
          <Text>Отправить</Text>
        </ActionBar>,
      ),
    );

    expect(barStyle().paddingBottom).toBe(Spacing.md + bottom);
  });

  test('above the tab bar it keeps its own margin only', async () => {
    await render(
      withBottomInset(
        bottom,
        <ActionBar testID="bar">
          <Text>Создать задание</Text>
        </ActionBar>,
      ),
    );

    expect(barStyle().paddingBottom).toBe(Spacing.md);
  });
});
