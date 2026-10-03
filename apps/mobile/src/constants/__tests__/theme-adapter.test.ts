import {
  FONT_SIZE,
  RADIUS,
  SPACING,
  STATUS_TONE,
  THEME_COLORS,
  THEME_NAMES,
  TONE_COLORS,
  TOUCH_TARGET,
} from '@str-ops/shared';

import { contrastRatio } from '../../../../../packages/shared/src/testing/color-math';
import {
  BUTTON_HEIGHT,
  Colors,
  FontSize,
  MIN_TOUCH_TARGET,
  ROW_HEIGHT,
  Radius,
  Spacing,
  statusTone,
} from '../theme';

/**
 * `constants/theme.ts` is an adapter now: the names every screen already uses,
 * filled from the shared tokens of «Абрикос» (docs/redesign-plan.md §2.2). The
 * contrast of the tokens themselves is `design-contrast.test.ts`; this file
 * checks that the old names point where they should, and measures the few
 * pairs a screen makes out of them that the token guard does not list.
 */

const AA_TEXT = 4.5;
const NON_TEXT = 3;

describe.each(THEME_NAMES)('%s theme', (name) => {
  const c = Colors[name];
  const tokens = THEME_COLORS[name];

  test('the old names read the tokens', () => {
    expect(c.background).toBe(tokens.bg);
    expect(c.card).toBe(tokens.surface);
    expect(c.text).toBe(tokens.text);
    expect(c.textSecondary).toBe(tokens.textSecondary);
    expect(c.border).toBe(tokens.border);
    expect(c.divider).toBe(tokens.divider);
    expect(c.primary).toBe(tokens.primary);
    expect(c.onPrimary).toBe(tokens.onPrimary);
    expect(c.danger).toBe(tokens.danger);
  });

  test('the main button is the sun-proof cta, not the primary', () => {
    expect(c.cta).toBe(tokens.cta);
    expect(c.onCta).toBe(tokens.onCta);
    expect(c.ctaPressed).toBe(tokens.ctaPressed);
  });

  test('carries the thirteen tones of the contract', () => {
    expect(c.tone).toBe(TONE_COLORS[name]);
  });

  test('knows which theme it is, for the street step-up of the text', () => {
    expect(c.scheme).toBe(name);
  });

  // Green used to mean "done", "cancelled", "a new message" and "mine" at once:
  // the pairs are gone, and a screen asks the contract for a tone by meaning.
  test('has no urgent/calm pair left to reach for', () => {
    for (const key of ['urgentText', 'urgentSurface', 'calmText', 'calmSurface']) {
      expect(c).not.toHaveProperty(key);
    }
  });

  test('reads a tone by its meaning', () => {
    expect(statusTone(c, 'phone.checkIn.sameDay')).toBe(TONE_COLORS[name].urgent);
    expect(statusTone(c, 'chat.ownBubble')).toBe(TONE_COLORS[name][STATUS_TONE['chat.ownBubble']]);
  });

  test('the scrim is the token colour at the token alpha', () => {
    expect(c.scrim).toBe('rgba(30, 21, 17, 0.64)');
  });

  // Pairs a screen draws that the token guard does not list (measured
  // 2026-10-03: the lowest is the accepted chip's outline, 3.92).
  test.each([
    { label: 'text in her own chat bubble', fg: c.text, bg: c.tone.neutral.bg, min: AA_TEXT },
    {
      label: 'time and author in her own chat bubble',
      fg: c.textSecondary,
      bg: c.tone.neutral.bg,
      min: AA_TEXT,
    },
    { label: 'the action of an urgent notice', fg: c.primary, bg: c.tone.urgent.bg, min: AA_TEXT },
    {
      label: 'a done step’s status on the screen background',
      fg: c.tone.done.fg,
      bg: c.background,
      min: AA_TEXT,
    },
    {
      label: 'the «Обязательно» chip on the screen background',
      fg: c.tone.neutral.fg,
      bg: c.background,
      min: AA_TEXT,
    },
    {
      label: 'the outline of the accepted chip on a card',
      fg: c.tone.assigned.border,
      bg: c.card,
      min: NON_TEXT,
    },
    { label: 'a disabled button’s label', fg: c.textMuted, bg: c.surfaceAlt, min: AA_TEXT },
  ])('$label: at least $min:1', ({ fg, bg, min }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

test('both themes define exactly the same names', () => {
  expect(Object.keys(Colors.dark).sort()).toEqual(Object.keys(Colors.light).sort());
});

test('spacing keeps the 4 dp hairline gap the direction has no step for', () => {
  expect(Spacing).toEqual({ xs: 4, ...SPACING });
});

test('the old radii keep their values; the new ones are named for what they round', () => {
  expect(Radius.md).toBe(RADIUS.sm);
  expect(Radius.lg).toBe(RADIUS.md);
  expect(Radius.card).toBe(RADIUS.lg);
  expect(Radius.sheet).toBe(RADIUS.xl);
  expect(Radius.pill).toBe(RADIUS.pill);
});

test('type sizes are the direction’s', () => {
  expect(FontSize).toBe(FONT_SIZE);
});

test('touch targets: 48 for any control, 56 for a button, 64 for a list row', () => {
  expect(MIN_TOUCH_TARGET).toBe(TOUCH_TARGET.phoneMin);
  expect(BUTTON_HEIGHT).toBe(TOUCH_TARGET.phoneButton);
  expect(ROW_HEIGHT).toBe(TOUCH_TARGET.phoneRow);
});
