import { FONT_SIZE, THEME_COLORS } from '@str-ops/shared';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, type TextStyle } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { FontsReadyProvider } from '@/lib/fonts-ready';

import { NUNITO_FAMILY, Text, navigationFonts, resolveWeight } from '../text';

/**
 * The text component is where a weight becomes a font. On Android a loaded
 * font is registered as one face only: `fontWeight: '600'` over it is ignored
 * and `'700'` is faked with the system's bold (docs/redesign-plan.md §2.2, 8
 * p.6). So each weight is a family of its own, and nothing else in the app
 * sets a weight (design-font-weight.test.ts).
 */

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
const scheme = jest.mocked(useColorScheme);

function styleOf(text: string): TextStyle {
  return StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle;
}

function withFonts(children: ReactNode, isReady = true) {
  return <FontsReadyProvider value={isReady}>{children}</FontsReadyProvider>;
}

beforeEach(() => {
  scheme.mockReturnValue('light');
});

describe('weight → family', () => {
  test.each([
    [400, 'Nunito_400Regular'],
    [600, 'Nunito_600SemiBold'],
    [700, 'Nunito_700Bold'],
    [800, 'Nunito_800ExtraBold'],
  ] as const)('%d is drawn with %s and no fontWeight', async (weight, family) => {
    await render(withFonts(<Text weight={weight}>Уборка</Text>));

    const style = styleOf('Уборка');
    expect(style.fontFamily).toBe(family);
    expect(style.fontWeight).toBeUndefined();
  });

  test('a variant brings its own weight: a title is bold', async () => {
    await render(withFonts(<Text variant="title">Nádražní 6</Text>));

    expect(styleOf('Nádražní 6').fontFamily).toBe(NUNITO_FAMILY[700]);
  });

  test('before the fonts load, the system font with a weight — never a family that is not there', async () => {
    await render(withFonts(<Text variant="title">Nádražní 6</Text>, false));

    const style = styleOf('Nádražní 6');
    expect(style.fontFamily).toBeUndefined();
    expect(style.fontWeight).toBe('700');
  });

  test('outside any provider, the system font', async () => {
    await render(<Text>Уборка</Text>);

    expect(styleOf('Уборка').fontFamily).toBeUndefined();
  });
});

describe('sizes and colours come from the tokens', () => {
  test.each([
    ['caption', FONT_SIZE.caption],
    ['chip', FONT_SIZE.caption],
    ['body', FONT_SIZE.body],
    ['button', FONT_SIZE.button],
    ['title', FONT_SIZE.title],
    ['heading', FONT_SIZE.heading],
    ['display', FONT_SIZE.display],
  ] as const)('%s is %d', async (variant, size) => {
    await render(<Text variant={variant}>Слово</Text>);

    expect(styleOf('Слово').fontSize).toBe(size);
  });

  test('body text is the theme’s text colour', async () => {
    await render(<Text>Слово</Text>);

    expect(styleOf('Слово').color).toBe(THEME_COLORS.light.text);
  });

  test('a tone picks its role', async () => {
    await render(<Text tone="danger">Ошибка</Text>);

    expect(styleOf('Ошибка').color).toBe(THEME_COLORS.light.danger);
  });

  test('in the dark theme the same tone reads the dark role', async () => {
    scheme.mockReturnValue('dark');
    await render(<Text tone="secondary">Слово</Text>);

    expect(styleOf('Слово').color).toBe(THEME_COLORS.dark.textSecondary);
  });

  test('an explicit colour — a chip’s tone — wins over the tone', async () => {
    await render(
      <Text tone="secondary" color="#005e3c">
        Готово
      </Text>,
    );

    expect(styleOf('Готово').color).toBe('#005e3c');
  });
});

// The street (plan §8 p.4): under sunlight only the main text holds, so in the
// light theme the quieter text and the chips are drawn one step heavier.
describe('the street step-up', () => {
  test.each([
    ['secondary body text', { variant: 'body', tone: 'secondary' }, 700],
    ['muted body text', { variant: 'body', tone: 'muted' }, 700],
    ['a caption', { variant: 'caption', tone: 'default' }, 700],
    ['a chip', { variant: 'chip', tone: 'default' }, 800],
    ['main body text stays', { variant: 'body', tone: 'default' }, 600],
    ['a heading stays', { variant: 'heading', tone: 'default' }, 800],
  ] as const)('light theme: %s → %d', (_label, props, weight) => {
    expect(resolveWeight({ ...props, scheme: 'light' })).toBe(weight);
  });

  test.each([
    ['secondary body text', { variant: 'body', tone: 'secondary' }, 600],
    ['a caption', { variant: 'caption', tone: 'default' }, 600],
    ['a chip', { variant: 'chip', tone: 'default' }, 700],
  ] as const)('dark theme: %s keeps %d', (_label, props, weight) => {
    expect(resolveWeight({ ...props, scheme: 'dark' })).toBe(weight);
  });

  test('an asked weight steps up too, and 800 is the top', () => {
    expect(resolveWeight({ variant: 'body', tone: 'secondary', weight: 400, scheme: 'light' })).toBe(
      600,
    );
    expect(resolveWeight({ variant: 'chip', tone: 'default', weight: 800, scheme: 'light' })).toBe(
      800,
    );
  });

  test('drawn: a secondary line in the light theme is semibold → bold', async () => {
    await render(withFonts(<Text tone="secondary">Nádražní 6 · 10:00–15:00</Text>));

    expect(styleOf('Nádražní 6 · 10:00–15:00').fontFamily).toBe(NUNITO_FAMILY[700]);
  });
});

describe('accessibility', () => {
  test('follows the system font size: scaling is never switched off', async () => {
    await render(<Text>Слово</Text>);

    expect(screen.getByText('Слово').props.allowFontScaling).not.toBe(false);
  });

  test('passes its role on', async () => {
    await render(
      <Text variant="heading" accessibilityRole="header">
        Настройки
      </Text>,
    );

    expect(screen.getByRole('header', { name: 'Настройки' })).toBeTruthy();
  });
});

describe('the navigation chrome', () => {
  /** What React Navigation draws with by itself, per platform. */
  const SYSTEM_FONTS = {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '600' },
    heavy: { fontFamily: 'System', fontWeight: '700' },
  } as const;

  test('headers and tabs get the families once the fonts are in, weight left normal', () => {
    expect(navigationFonts(true, SYSTEM_FONTS)).toEqual({
      regular: { fontFamily: NUNITO_FAMILY[400], fontWeight: 'normal' },
      medium: { fontFamily: NUNITO_FAMILY[600], fontWeight: 'normal' },
      bold: { fontFamily: NUNITO_FAMILY[700], fontWeight: 'normal' },
      heavy: { fontFamily: NUNITO_FAMILY[800], fontWeight: 'normal' },
    });
  });

  test('without the fonts, the chrome keeps the platform’s own', () => {
    expect(navigationFonts(false, SYSTEM_FONTS)).toBe(SYSTEM_FONTS);
  });
});
