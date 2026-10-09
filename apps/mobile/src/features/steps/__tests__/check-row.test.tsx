import { THEME_COLORS } from '@str-ops/shared';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

import { CheckRow } from '../check-row';

/**
 * One thing to tick off. Once ticked its words go quieter — never heavier:
 * in the light theme quiet text is stepped up a weight for the sun (text.tsx),
 * and a done line drawn bolder than the open ones would pull the eye to the
 * work that is finished.
 */

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
const scheme = jest.mocked(useColorScheme);

function wordsOf(label: string): TextStyle {
  return StyleSheet.flatten(screen.getByText(label).props.style) as TextStyle;
}

/** The face a text is drawn with: its family once the fonts are in, else its weight. */
function face(style: TextStyle): unknown {
  return style.fontFamily ?? style.fontWeight;
}

beforeEach(() => {
  scheme.mockReturnValue('light');
});

test.each(['light', 'dark'] as const)(
  '%s theme: a ticked line weighs the same as an open one, only quieter',
  async (name) => {
    // Arrange
    scheme.mockReturnValue(name);

    // Act
    await render(
      <>
        <CheckRow label="Зеркало" isChecked={false} isDisabled={false} onToggle={jest.fn()} />
        <CheckRow label="Плита" isChecked isDisabled={false} onToggle={jest.fn()} />
      </>,
    );

    // Assert
    const open = wordsOf('Зеркало');
    const ticked = wordsOf('Плита');
    expect(face(ticked)).toBe(face(open));
    expect(open.color).toBe(THEME_COLORS[name].text);
    expect(ticked.color).toBe(THEME_COLORS[name].textSecondary);
  },
);
