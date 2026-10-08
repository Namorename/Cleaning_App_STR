import { THEME_COLORS } from '@str-ops/shared';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { RefusalError } from '@/lib/server-error';

import { FailureText } from '../failure-text';

/**
 * A move that failed, said next to the button she retries with: the reason in
 * her language, and for an unknown failure the server's words small under it
 * (CLAUDE.md) — never the raw message alone.
 */

test('an unknown failure: the general sentence in the danger colour, the server’s words under it', async () => {
  await render(<FailureText error={new Error('Network request failed')} />);

  const sentence = screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.');
  expect((StyleSheet.flatten(sentence.props.style) as TextStyle).color).toBe(
    THEME_COLORS.light.danger,
  );
  expect(screen.getByText('Network request failed')).toBeTruthy();
});

test('a refusal the app knows is said in her words, with nothing raw under it', async () => {
  await render(
    <FailureText error={new RefusalError('Claim matched no row', 'tasks.claimTaken')} />,
  );

  expect(screen.queryByText('Claim matched no row')).toBeNull();
});
