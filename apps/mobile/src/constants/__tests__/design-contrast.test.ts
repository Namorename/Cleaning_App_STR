import { THEME_COLORS, THEME_NAMES, TONE_COLORS, type ThemeName, type Tone } from '@str-ops/shared';

import {
  compositeOver,
  contrastRatio,
  veiledContrast,
} from '../../../../../packages/shared/src/testing/color-math';

/**
 * Every pair of colours a person has to read or find, in both themes, measured
 * from the shared tokens — the phone's and the panel's alike.
 *
 * The list is the comparison page's (`contrastPairs` in
 * docs/design/redesign-directions.html) for direction A, so the numbers here
 * are the numbers the owner chose from; plus the roles the page did not have —
 * the phone's main button on the sun (decisions §3) and its pressed state.
 * 112 checks on the page cleared their threshold by less than 0.5: a "small"
 * tweak of one hex can drop one of them, and this is where it shows.
 *
 * Thresholds are WCAG 2.2 without rounding (4.499 does not pass 4.5): text
 * 4.5:1 (1.4.3), and 7:1 (1.4.6) for body text and the main buttons in the
 * light theme, as the page asks; a mark or an outline the user has to find
 * 3:1 (1.4.11).
 */

const AA_TEXT = 4.5;
const AAA_TEXT = 7;
const NON_TEXT = 3;
/** The street criterion of the main button's label under the 40 % veil (decisions §3). */
const STREET_MAIN = 4.5;
/** Not a WCAG rule: the floor at which a hairline divider is still visible (the phone's old guard). */
const VISIBLE_DIVIDER = 1.2;
/** A caption on a photo sits on the scrim laid over the brightest photo there is. */
const WHITE_PHOTO = '#ffffff';

interface Pair {
  readonly fg: string;
  readonly bg: string;
  readonly min: number;
}

/**
 * A mark that is pale on purpose: below 3:1, and the page says what carries its
 * meaning instead. The companions are pairs of this list that must pass.
 */
interface QuietPair {
  readonly fg: string;
  readonly bg: string;
  readonly why: string;
  readonly companions: readonly string[];
}

/** The chip tones — the four tones without a chip (bars, the pill, the badge) are checked as marks. */
const CHIP_TONES: readonly Tone[] = [
  'neutral',
  'unassigned',
  'assigned',
  'inProgress',
  'done',
  'overdue',
  'notHappened',
  'cancelled',
  'urgent',
];

/** The calendar marks a status is drawn with, and the step circles (filled and ringed). */
const SOLID_MARKS: readonly Tone[] = [
  'assigned',
  'inProgress',
  'done',
  'unassigned',
  'overdue',
  'notHappened',
];

function pairsOf(theme: ThemeName): ReadonlyMap<string, Pair> {
  const c = THEME_COLORS[theme];
  const t = TONE_COLORS[theme];
  const isLight = theme === 'light';
  const mainText = isLight ? AAA_TEXT : AA_TEXT;
  const surfaces = [
    ['bg', c.bg],
    ['surface', c.surface],
    ['surfaceAlt', c.surfaceAlt],
  ] as const;
  const pairs = new Map<string, Pair>();
  const add = (label: string, fg: string, bg: string, min: number): void => {
    pairs.set(label, { fg, bg, min });
  };

  for (const [name, hex] of surfaces) {
    add(`text on ${name}`, c.text, hex, mainText);
    add(`textSecondary on ${name}`, c.textSecondary, hex, AA_TEXT);
    add(`textMuted on ${name}`, c.textMuted, hex, AA_TEXT);
    add(`link on ${name}`, c.link, hex, AA_TEXT);
    add(`danger (error text) on ${name}`, c.danger, hex, AA_TEXT);
    add(`border (input outline) against ${name}`, c.border, hex, NON_TEXT);
    add(`focusRing against ${name}`, c.focusRing, hex, NON_TEXT);
  }
  add('danger on urgent.bg (tonal destructive button)', c.danger, t.urgent.bg, AA_TEXT);
  add('textSecondary on the «today» underlay («+N» in the column)', c.textSecondary, t.today.bg, AA_TEXT);
  add('divider against surface', c.divider, c.surface, VISIBLE_DIVIDER);

  add('onPrimary on primary', c.onPrimary, c.primary, mainText);
  add('onPrimary on primaryPressed', c.onPrimary, c.primaryPressed, mainText);
  add('onAccent on accent (active tab, «today» pill)', c.onAccent, c.accent, AA_TEXT);
  add('onDanger on danger', c.onDanger, c.danger, AA_TEXT);
  add('onSecondary on secondary (tonal button)', c.onSecondary, c.secondary, AA_TEXT);
  add('onCta on cta (the phone’s main button)', c.onCta, c.cta, mainText);
  add('onCta on ctaPressed', c.onCta, c.ctaPressed, mainText);
  add('primary (button fill, «now» stripe) against bg', c.primary, c.bg, NON_TEXT);
  add('primary against surface', c.primary, c.surface, NON_TEXT);
  add('cta against bg', c.cta, c.bg, NON_TEXT);
  add('cta against surface', c.cta, c.surface, NON_TEXT);

  for (const tone of CHIP_TONES) {
    add(`${tone}: chip text on its own fill`, t[tone].fg, t[tone].bg, AA_TEXT);
    add(`${tone}: chip text on surface`, t[tone].fg, c.surface, AA_TEXT);
    add(`${tone}: chip text on surfaceAlt (7-day calendar)`, t[tone].fg, c.surfaceAlt, AA_TEXT);
    add(`${tone}: chip text on the «today» underlay`, t[tone].fg, t.today.bg, AA_TEXT);
  }
  add('today: its chip’s text on the «today» underlay', t.today.fg, t.today.bg, AA_TEXT);
  add('unread badge: text on its fill', t.unread.onMark, t.unread.mark, AA_TEXT);
  add('«today» pill: the date on the accent', t.today.onMark, t.today.mark, AA_TEXT);
  add('booking bar: the guest’s name', t.booking.onMark, t.booking.mark, AA_TEXT);
  add('block: «Блок (не гость)» on its plate', t.block.fg, t.block.mark, AA_TEXT);
  add('✓ on a done step', t.done.onMark, t.done.mark, AA_TEXT);
  add(
    'onScrim on the scrim over a white photo',
    c.onScrim,
    compositeOver(c.scrim, c.scrimAlpha, WHITE_PHOTO),
    AA_TEXT,
  );
  add('«!» of «Заблокирована» (urgent.fg) on bg (calendar legend)', t.urgent.fg, c.bg, AA_TEXT);

  for (const tone of SOLID_MARKS) {
    add(`${tone} mark against surface`, t[tone].mark, c.surface, NON_TEXT);
    add(`${tone} mark against the «today» underlay`, t[tone].mark, t.today.bg, NON_TEXT);
  }
  add('«Срочно» / double-booking ring against bg (legend)', t.urgent.mark, c.bg, NON_TEXT);
  add('booking bar outline against surface', t.booking.border, c.surface, NON_TEXT);
  add('block outline against surface', t.block.border, c.surface, NON_TEXT);
  add('block hatch against its fill', t.block.hatch, t.block.mark, NON_TEXT);
  add('«Не состоялась» chip frame against surface', t.notHappened.border, c.surface, NON_TEXT);
  add('«Не состоялась» hatch against its chip fill', t.notHappened.hatch, t.notHappened.bg, NON_TEXT);
  add('«today» column frame against surface', t.today.border, c.surface, NON_TEXT);
  for (const tone of CHIP_TONES.filter((key) => key !== 'urgent')) {
    add(`${tone}: chip frame on the «today» underlay`, t[tone].border, t.today.bg, NON_TEXT);
  }
  add('ringed circle of a step not done yet against surface', t.neutral.mark, c.surface, NON_TEXT);
  return pairs;
}

function quietPairsOf(theme: ThemeName): ReadonlyMap<string, QuietPair> {
  const c = THEME_COLORS[theme];
  const t = TONE_COLORS[theme];
  return new Map<string, QuietPair>([
    [
      'booking bar fill against surface',
      {
        fg: t.booking.mark,
        bg: c.surface,
        why: 'the outline and the guest’s name carry the bar',
        companions: ['booking bar outline against surface', 'booking bar: the guest’s name'],
      },
    ],
    [
      'block fill against surface',
      {
        fg: t.block.mark,
        bg: c.surface,
        why: 'quiet on purpose: the outline and the 135° hatch carry it',
        companions: ['block outline against surface', 'block hatch against its fill'],
      },
    ],
    [
      'grey square «Отменена» and the ring of a skipped step against surface',
      {
        fg: t.cancelled.mark,
        bg: c.surface,
        why: 'pale on purpose: the square, the ✕, the struck-out word, hidden by default',
        companions: ['cancelled: chip text on surface'],
      },
    ],
    [
      '«today» pill against surface',
      {
        fg: t.today.mark,
        bg: c.surface,
        why: 'the pill carries the word and the date, the column its frame, aria-current',
        companions: ['«today» pill: the date on the accent', '«today» column frame against surface'],
      },
    ],
  ]);
}

describe.each(THEME_NAMES)('%s theme', (theme) => {
  const pairs = [...pairsOf(theme)].map(([label, pair]) => ({ label, ...pair }));

  test.each(pairs)('$label: at least $min:1', ({ fg, bg, min }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  test('the phone’s main button label holds 4.5:1 under the 40 % veil (decisions §3)', () => {
    const c = THEME_COLORS[theme];
    expect(veiledContrast(c.onCta, c.cta)).toBeGreaterThanOrEqual(STREET_MAIN);
  });

  const quiet = [...quietPairsOf(theme)].map(([label, pair]) => ({ label, ...pair }));

  // A pale mark is allowed only next to something that does read: the pairs
  // the page names as carrying its meaning exist above, and pass there.
  test.each(quiet)('$label is never the only cue', ({ companions }) => {
    const known = pairsOf(theme);
    for (const companion of companions) {
      const pair = known.get(companion);
      if (pair === undefined) {
        throw new Error(`No such pair to carry a quiet mark: ${companion}`);
      }
      expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(pair.min);
    }
  });
});
