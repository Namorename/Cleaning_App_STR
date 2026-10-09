import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { Colors, FontSize } from '@/constants/theme';

import { LoadingState } from '../loading-state';

/**
 * A screen waiting on something with no shape to show yet — the stored
 * session on a cold start. One element for the reader: «loading», busy, in
 * the screen's own words; on screen a spinner on the tokens and the same words.
 */

const light = Colors.light;

test('is one element for the reader: a progress bar named by its words, busy', async () => {
  await render(<LoadingState label="Входим…" />);

  const loading = screen.getByRole('progressbar', { name: 'Входим…' });
  expect(loading.props.accessibilityState).toMatchObject({ busy: true });
});

test('draws the spinner and the words in the secondary text colour, on the screen', async () => {
  await render(<LoadingState label="Входим…" />);

  const spinner = screen.getByTestId('loading-spinner', { includeHiddenElements: true });
  expect(spinner.props.color).toBe(light.textSecondary);
  const words = StyleSheet.flatten(screen.getByText('Входим…').props.style) as TextStyle;
  expect(words.color).toBe(light.textSecondary);
  expect(words.fontSize).toBe(FontSize.body);
  const box = StyleSheet.flatten(
    screen.getByRole('progressbar', { name: 'Входим…' }).props.style,
  ) as ViewStyle;
  expect(box).toMatchObject({
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: light.background,
  });
});
