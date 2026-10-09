import {
  FONT_SIZE,
  RADIUS,
  SPACING,
  STATUS_TONE,
  THEME_COLORS,
  TONE_COLORS,
  TONE_NAMES,
  TOUCH_TARGET,
  type HexColor,
  type StatusKey,
  type ThemeName,
  type Tone,
  type ToneColors,
} from '@str-ops/shared';
import type { TextStyle, ViewStyle } from 'react-native';

/**
 * The phone's palette and sizes: an adapter over the shared tokens of
 * direction A, Abrikos (`packages/shared/src/design/tokens.ts`,
 * docs/redesign-plan.md §2.2).
 *
 * Screens built before the redesign read the names they always read —
 * `background`, `card`, `Radius.lg`, `FontSize.body` — and get the new palette
 * without a line of their own changing; the screens move onto the components
 * in 5.4. New code reads the roles by their token names (`cta`, `surfaceAlt`,
 * `tone`), and a status by its meaning through `statusTone`.
 *
 * Every colour the app paints still lives in one place. Nothing hardcodes a
 * hex value in a StyleSheet: a value written into a component exists in one
 * theme only, and the one missing from the other theme is exactly how the
 * first build printed black text on a black background. Contrast is measured
 * on the tokens by `__tests__/design-contrast.test.ts`, and the pairs screens
 * make out of them by `__tests__/theme-adapter.test.ts`.
 */

export type { ThemeName } from '@str-ops/shared';

/** The colours of one theme, by the names the screens use. */
export interface Theme {
  /** Which theme this is: the text component steps up its weights in the light one. */
  readonly scheme: ThemeName;
  /** The screen behind everything (token `bg`). */
  readonly background: HexColor;
  /** Cards, sheets and section blocks (token `surface`). */
  readonly card: HexColor;
  /** A step off the card: an inactive control, a disabled button. */
  readonly surfaceAlt: HexColor;
  readonly text: HexColor;
  readonly textSecondary: HexColor;
  /** The quietest text that still reads; the disabled label. */
  readonly textMuted: HexColor;
  /** Outline of an input or other control the user has to find. */
  readonly border: HexColor;
  /** Decorative edge of a card; deliberately quieter than `border`. */
  readonly divider: HexColor;
  /** Links, the active choice, outlined buttons, the «now» stripe. */
  readonly primary: HexColor;
  readonly onPrimary: HexColor;
  readonly primaryPressed: HexColor;
  /** The tonal secondary button. */
  readonly secondary: HexColor;
  readonly onSecondary: HexColor;
  /** The main button: deeper than `primary`, so its label reads in the sun. */
  readonly cta: HexColor;
  readonly onCta: HexColor;
  readonly ctaPressed: HexColor;
  readonly accent: HexColor;
  readonly onAccent: HexColor;
  /** Error text and the destructive button's label; never a fill like the main button. */
  readonly danger: HexColor;
  readonly onDanger: HexColor;
  readonly focusRing: HexColor;
  readonly link: HexColor;
  /** The darkening under a sheet or a caption on a photo, alpha included. */
  readonly scrim: string;
  readonly onScrim: HexColor;
  /** The soft shadow a card sits on, in place of a frame (decisions §1, the shape). */
  readonly shadow: string;
  /** The thirteen tones every status is drawn in; read one through `statusTone`. */
  readonly tone: Readonly<Record<Tone, ToneColors>>;
}

/** `#rrggbb` at an alpha, as React Native reads a colour. */
function withAlpha(hex: HexColor, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${alpha})`;
}

/** How dark a card's shadow is: a dark screen needs more of it to show at all. */
const SHADOW_ALPHA: Readonly<Record<ThemeName, number>> = { light: 0.1, dark: 0.4 };

function phoneTheme(scheme: ThemeName): Theme {
  const c = THEME_COLORS[scheme];
  return {
    scheme,
    background: c.bg,
    card: c.surface,
    surfaceAlt: c.surfaceAlt,
    text: c.text,
    textSecondary: c.textSecondary,
    textMuted: c.textMuted,
    border: c.border,
    divider: c.divider,
    primary: c.primary,
    onPrimary: c.onPrimary,
    primaryPressed: c.primaryPressed,
    secondary: c.secondary,
    onSecondary: c.onSecondary,
    cta: c.cta,
    onCta: c.onCta,
    ctaPressed: c.ctaPressed,
    accent: c.accent,
    onAccent: c.onAccent,
    danger: c.danger,
    onDanger: c.onDanger,
    focusRing: c.focusRing,
    link: c.link,
    scrim: withAlpha(c.scrim, c.scrimAlpha),
    onScrim: c.onScrim,
    shadow: `0px 2px 8px ${withAlpha(c.scrim, SHADOW_ALPHA[scheme])}`,
    tone: TONE_COLORS[scheme],
  };
}

export const Colors: Readonly<Record<ThemeName, Theme>> = {
  light: phoneTheme('light'),
  dark: phoneTheme('dark'),
};

/**
 * The colours of a status, by what it means rather than by its colour: the
 * contract (`STATUS_TONE`) decides that a same-day check-in is urgent and a
 * message on its way neutral, and no screen decides it again. (Her own chat
 * bubble is not a status: it is drawn in the `secondary` role.)
 */
export function statusTone(theme: Theme, key: StatusKey): ToneColors {
  return theme.tone[STATUS_TONE[key]];
}

/** A chip in a tone: its fill and its words. */
export interface ToneChipStyle {
  readonly box: ViewStyle;
  readonly label: TextStyle;
}

const toneChipCache = new WeakMap<Theme, Readonly<Record<Tone, ToneChipStyle>>>();

/**
 * The chip of every tone as styles, built once per theme: a list of cards
 * picks a status's chip without allocating a style per card.
 */
export function toneChipStyles(theme: Theme): Readonly<Record<Tone, ToneChipStyle>> {
  const cached = toneChipCache.get(theme);
  if (cached !== undefined) {
    return cached;
  }
  const chips = Object.fromEntries(
    TONE_NAMES.map((tone) => [
      tone,
      { box: { backgroundColor: theme.tone[tone].bg }, label: { color: theme.tone[tone].fg } },
    ]),
  ) as Record<Tone, ToneChipStyle>;
  toneChipCache.set(theme, chips);
  return chips;
}

/**
 * Spacing. The direction's steps, plus `xs`: direction A has no 4 dp step, but
 * a hairline gap between a title and its second line is what the screens use
 * it for, and it stays.
 */
export const Spacing = {
  xs: 4,
  ...SPACING,
} as const;

/**
 * Corner radii. `md` and `lg` are the old names with their old values (10 and
 * 14 — the direction's `sm` and `md`), so no screen changes shape before 5.4;
 * the rest are named for what they round.
 */
export const Radius = {
  md: RADIUS.sm,
  lg: RADIUS.md,
  card: RADIUS.lg,
  sheet: RADIUS.xl,
  pill: RADIUS.pill,
} as const;

/** Type sizes: body 16, title 18, heading 24 (before the redesign 15, 17 and 22). */
export const FontSize = FONT_SIZE;

/** Any control a finger has to hit. iOS asks for 44pt, Android for 48dp; the larger. */
export const MIN_TOUCH_TARGET = TOUCH_TARGET.phoneMin;

/** A button: 56 dp, for a gloved finger (owner's decision 5, 2026-10-02). */
export const BUTTON_HEIGHT = TOUCH_TARGET.phoneButton;

/** A row of a list. */
export const ROW_HEIGHT = TOUCH_TARGET.phoneRow;

/**
 * Icon sizes, dp. `regular` is Lucide's 24-unit grid drawn 1:1 — the box a
 * button, a row or a tab centres in its ≥ 48 dp target; `small` sits beside a
 * chip's 13 dp words.
 */
export const IconSize = {
  small: 16,
  regular: 24,
} as const;

export type IconSizeName = keyof typeof IconSize;
