import { HATCH_ANGLE } from '@str-ops/shared';

import { toneVar } from './theme-css';

export type HatchedTone = keyof typeof HATCH_ANGLE;

/**
 * Each hatch as the comparison page drew and measured it
 * (docs/design/redesign-directions.html): a thin line of the tone's `hatch`
 * colour, then the fill showing through — so the words on top still read.
 * [line, period], px.
 */
const STRIPES: Readonly<Record<HatchedTone, readonly [number, number]>> = {
  notHappened: [1.6, 5],
  block: [1.5, 6],
};

/**
 * The stripes of a hatched tone as a `background-image`: 45° on «Не
 * состоялась», 135° on «Блок» (`HATCH_ANGLE`) — the slant tells them apart
 * where their colours nearly meet under deuteranopia.
 */
export function hatchImage(tone: HatchedTone): string {
  const [line, period] = STRIPES[tone];
  const stripe = `${toneVar(tone, 'hatch')} 0 ${line}px`;
  const gap = `transparent ${line}px ${period}px`;
  return `repeating-linear-gradient(${HATCH_ANGLE[tone]}deg, ${stripe}, ${gap})`;
}
