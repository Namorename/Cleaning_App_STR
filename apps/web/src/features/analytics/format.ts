import { INTL_LOCALES, type Language } from '@str-ops/shared';

import type { NameMode } from './schema';

/** A figure there was nothing to count for (a mean of no cleanings). */
export const NO_VALUE = '—';

const formats = new Map<string, Intl.NumberFormat>();

/** One Intl.NumberFormat per language and options: building one is costly. */
function numberFormat(language: Language, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${language}:${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(INTL_LOCALES[language], options);
    formats.set(key, format);
  }
  return format;
}

/** A number in the chosen language's own way, with at most `digits` decimals. */
export function formatNumber(value: number | null, language: Language, digits = 0): string {
  if (value === null) {
    return NO_VALUE;
  }
  return numberFormat(language, { maximumFractionDigits: digits }).format(value);
}

/** A share (0–1) as a percentage, with at most one decimal. */
export function formatPercent(share: number | null, language: Language): string {
  if (share === null) {
    return NO_VALUE;
  }
  return numberFormat(language, { style: 'percent', maximumFractionDigits: 1 }).format(share);
}

/** How a figure moved against the previous period. */
export interface Change {
  /** A count moves relatively (+20 %); a share moves in percentage points (+5). */
  kind: 'relative' | 'points';
  value: number;
  direction: 'up' | 'down' | 'flat';
  /** Whether the move is good news: more done cleanings are, more open tasks are not. */
  tone: 'good' | 'bad' | 'neutral';
}

export type Better = 'up' | 'down' | 'none';

/**
 * The change of a figure against the previous period, or null when there is
 * nothing to compare with: no figure, or a count that was zero before (a rise
 * from nothing has no percentage).
 */
export function changeOf(
  current: number | null,
  previous: number | null,
  kind: Change['kind'] = 'relative',
  better: Better = 'up',
): Change | null {
  if (current === null || previous === null) {
    return null;
  }
  let value: number;
  if (kind === 'points') {
    value = Math.round((current - previous) * 1000) / 10;
  } else {
    if (previous === 0) {
      return null;
    }
    value = (current - previous) / previous;
  }
  // The direction of the figure as it is shown: a +0.3 % move reads "0 %", flat.
  const shown = kind === 'points' ? value : Math.round(value * 100);
  const direction = shown > 0 ? 'up' : shown < 0 ? 'down' : 'flat';
  const tone =
    better === 'none' || direction === 'flat'
      ? 'neutral'
      : (direction === 'up') === (better === 'up')
        ? 'good'
        : 'bad';
  return { kind, value, direction, tone };
}

/** The change with its sign: "+20%", "−13%", or "+5" for points (the unit is the caller's). */
export function formatChange(change: Change, language: Language): string {
  if (change.kind === 'points') {
    return numberFormat(language, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(
      change.value,
    );
  }
  return numberFormat(language, {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(change.value);
}

/** A name shortened to its initials: "Anna Novak" → "A. N.". */
export function initials(name: string | null): string {
  if (name === null) {
    return '';
  }
  return name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '')
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}.`)
    .join(' ');
}

/** A person's name as the page shows it (owner, 2026-10-14: in full unless set to initials). */
export function personLabel(name: string | null, mode: NameMode): string {
  if (name === null || name.trim() === '') {
    return NO_VALUE;
  }
  return mode === 'initials' ? initials(name) : name;
}
