import { FONT, FONT_SIZE, FONT_WEIGHT, LINE_HEIGHT, type ThemeName } from '@str-ops/shared';
import { useMemo } from 'react';
import { Text as NativeText, type TextProps as NativeTextProps, type TextStyle } from 'react-native';

import type { Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFontsReady } from '@/lib/fonts-ready';

/**
 * The app's text, and the one place a weight is turned into a font.
 *
 * On Android a font loaded at run time is registered as a single face:
 * `fontWeight: '600'` over it is ignored, and `'700'` is faked by the system's
 * bold (docs/redesign-plan.md §2.2, §8 p.6). So every weight of Nunito is a
 * family of its own, chosen here; no other file sets `fontWeight` (guarded by
 * `constants/__tests__/design-font-weight.test.ts`). Until the fonts are in —
 * or if they never load — the system font is drawn with a real weight instead,
 * never a family that is not there.
 */

export type FontWeightStep = (typeof FONT.weights)[number];

/** The family of each weight, as `useFonts` registers them. */
export const NUNITO_FAMILY: Readonly<Record<FontWeightStep, string>> = {
  400: 'Nunito_400Regular',
  600: 'Nunito_600SemiBold',
  700: 'Nunito_700Bold',
  800: 'Nunito_800ExtraBold',
};

/** The kinds of text the direction defines; each brings its size and weight. */
export type TextVariant = keyof typeof FONT_WEIGHT;

const VARIANT_SIZE: Readonly<Record<TextVariant, number>> = {
  caption: FONT_SIZE.caption,
  chip: FONT_SIZE.caption,
  body: FONT_SIZE.body,
  button: FONT_SIZE.button,
  title: FONT_SIZE.title,
  heading: FONT_SIZE.heading,
  display: FONT_SIZE.display,
};

const TONE_ROLE = {
  default: 'text',
  secondary: 'textSecondary',
  muted: 'textMuted',
  primary: 'primary',
  link: 'link',
  danger: 'danger',
  onCta: 'onCta',
  onPrimary: 'onPrimary',
  onSecondary: 'onSecondary',
  onDanger: 'onDanger',
  onScrim: 'onScrim',
} as const satisfies Readonly<Record<string, keyof Theme>>;

/** Which role of the theme the text is drawn in. */
export type TextTone = keyof typeof TONE_ROLE;

const QUIET_TONES: ReadonlySet<TextTone> = new Set(['secondary', 'muted']);
const SMALL_VARIANTS: ReadonlySet<TextVariant> = new Set(['caption', 'chip']);

function heavier(weight: FontWeightStep): FontWeightStep {
  const steps = FONT.weights;
  return steps[Math.min(steps.indexOf(weight) + 1, steps.length - 1)];
}

export interface WeightInput {
  variant: TextVariant;
  tone: TextTone;
  weight?: FontWeightStep;
  scheme: ThemeName;
}

/**
 * The weight a text is drawn at. In sunlight only the main text still reads
 * (plan §8 p.4: under the 40 % veil secondary text falls to 2.6–2.8:1 in the
 * light theme), so there the quieter text, captions and chips are drawn one
 * step heavier. The dark theme is not read in the sun the same way and keeps
 * the direction's weights.
 */
export function resolveWeight({ variant, tone, weight, scheme }: WeightInput): FontWeightStep {
  const base = weight ?? FONT_WEIGHT[variant];
  const isStreetStep =
    scheme === 'light' && (QUIET_TONES.has(tone) || SMALL_VARIANTS.has(variant));
  return isStreetStep ? heavier(base) : base;
}

/** The face of a weight: its own family once the fonts are in, else a system weight. */
export function fontFace(weight: FontWeightStep, isReady: boolean): TextStyle {
  return isReady
    ? { fontFamily: NUNITO_FAMILY[weight] }
    : { fontWeight: String(weight) as TextStyle['fontWeight'] };
}

/** `fontFace` for a component that draws text without this one — an input. */
export function useFontFace(weight: FontWeightStep): TextStyle {
  const isReady = useFontsReady();
  return useMemo(() => fontFace(weight, isReady), [weight, isReady]);
}

type NavigationWeight =
  | 'normal'
  | 'bold'
  | '100'
  | '200'
  | '300'
  | '400'
  | '500'
  | '600'
  | '700'
  | '800'
  | '900';

export interface NavigationFonts {
  readonly regular: { readonly fontFamily: string; readonly fontWeight: NavigationWeight };
  readonly medium: { readonly fontFamily: string; readonly fontWeight: NavigationWeight };
  readonly bold: { readonly fontFamily: string; readonly fontWeight: NavigationWeight };
  readonly heavy: { readonly fontFamily: string; readonly fontWeight: NavigationWeight };
}

/**
 * The fonts of the headers and the tab bar, which React Navigation draws from
 * its theme. With Nunito loaded each slot is a family and the weight is left
 * `normal`, for the reason above; without it, the platform's own fonts.
 */
export function navigationFonts(isReady: boolean, system: NavigationFonts): NavigationFonts {
  if (!isReady) {
    return system;
  }
  return {
    regular: { fontFamily: NUNITO_FAMILY[400], fontWeight: 'normal' },
    medium: { fontFamily: NUNITO_FAMILY[600], fontWeight: 'normal' },
    bold: { fontFamily: NUNITO_FAMILY[700], fontWeight: 'normal' },
    heavy: { fontFamily: NUNITO_FAMILY[800], fontWeight: 'normal' },
  };
}

export interface TextProps extends NativeTextProps {
  /** Size and weight together; body by default. */
  variant?: TextVariant;
  /** The theme role it is drawn in; the main text colour by default. */
  tone?: TextTone;
  /** A colour of its own — a chip's tone — drawn instead of `tone`. */
  color?: string;
  /** Overrides the variant's weight; the street step-up still applies. */
  weight?: FontWeightStep;
  align?: TextStyle['textAlign'];
}

/**
 * Text in the direction's type scale. It follows the system font size like any
 * React Native text (`allowFontScaling` stays on); pass `style` for layout
 * only — margins, flex — never for a weight.
 */
export function Text({
  variant = 'body',
  tone = 'default',
  color,
  weight,
  align,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const isReady = useFontsReady();
  const drawn = resolveWeight({ variant, tone, weight, scheme: theme.scheme });
  const size = VARIANT_SIZE[variant];
  const ink = color ?? theme[TONE_ROLE[tone]];

  const typeStyle = useMemo<TextStyle>(
    () => ({
      fontSize: size,
      lineHeight: Math.round(size * LINE_HEIGHT),
      color: ink,
      textAlign: align,
      ...fontFace(drawn, isReady),
    }),
    [size, ink, align, drawn, isReady],
  );

  return <NativeText {...rest} style={[typeStyle, style]} />;
}
