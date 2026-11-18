import { CARD_COLORS, isCardColor } from '@str-ops/shared';
import type { CSSProperties } from 'react';

/**
 * A card's colour (packages/shared, CARD_COLORS): a stripe at its left edge
 * and a faint fill, each with its value for the light theme and the dark one.
 * The values travel as CSS variables on the element and the classes pick the
 * theme's pair, so the card follows the manager's theme and the system's
 * without a class per colour. A card with no colour gets neither.
 */
export const CARD_COLOR_CLASS =
  'border-l-4 border-l-(--card-stripe) bg-(--card-tint) dark:border-l-(--card-stripe-dark) dark:bg-(--card-tint-dark)';

/** The swatch of a colour picker: the stripe colour, in either theme. */
export const SWATCH_CLASS = 'bg-(--card-stripe) dark:bg-(--card-stripe-dark)';

export function cardColorStyle(color: string | null): CSSProperties | undefined {
  if (!isCardColor(color)) {
    return undefined;
  }
  const light = CARD_COLORS.light[color];
  const dark = CARD_COLORS.dark[color];
  return {
    '--card-stripe': light.stripe,
    '--card-tint': light.tint,
    '--card-stripe-dark': dark.stripe,
    '--card-tint-dark': dark.tint,
  } as CSSProperties;
}
