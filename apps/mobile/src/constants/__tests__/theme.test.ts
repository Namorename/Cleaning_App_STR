import { Colors, type ThemeName } from '../theme';

/**
 * Contrast is checked mechanically rather than by eye.
 *
 * The first build shipped a palette that only existed in light mode: card text
 * had no colour at all, so it fell back to black and became invisible on the
 * dark background — on the phone and in the browser alike. A screenshot review
 * would have caught that once; this catches it on every commit.
 *
 * Thresholds come from WCAG 2.2: 4.5:1 for body text (1.4.3) and 3:1 for the
 * boundary of a control the user has to find (1.4.11). The one number below
 * that WCAG does not define is the card divider, and it is labelled as such.
 */

const AA_TEXT = 4.5;
const AA_COMPONENT = 3;
/** Not a WCAG rule: the floor at which a hairline divider is still visible. */
const VISIBLE_DIVIDER = 1.2;

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) {
    throw new Error(`Ожидался цвет вида #rrggbb, получено ${hex}`);
  }
  const int = parseInt(match[1], 16);
  return (
    0.2126 * channel((int >> 16) & 0xff) +
    0.7152 * channel((int >> 8) & 0xff) +
    0.0722 * channel(int & 0xff)
  );
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

const themes: ThemeName[] = ['light', 'dark'];

describe.each(themes)('%s theme', (name) => {
  const c = Colors[name];

  test('body text is readable on the screen background', () => {
    expect(contrast(c.text, c.background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('body text is readable on a card', () => {
    expect(contrast(c.text, c.card)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('secondary text is readable on the screen background', () => {
    expect(contrast(c.textSecondary, c.background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('secondary text is readable on a card', () => {
    expect(contrast(c.textSecondary, c.card)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('the urgent banner is readable on its own surface', () => {
    expect(contrast(c.urgentText, c.urgentSurface)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('the ordinary banner is readable on its own surface', () => {
    expect(contrast(c.calmText, c.calmSurface)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // Forced-colour modes and high-contrast settings drop the tint and leave the
  // banner text sitting directly on the card.
  test('banner text survives losing its tinted surface', () => {
    expect(contrast(c.urgentText, c.card)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(c.calmText, c.card)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('the primary button label is readable on the button', () => {
    expect(contrast(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('the primary button is findable against the background', () => {
    expect(contrast(c.primary, c.background)).toBeGreaterThanOrEqual(AA_COMPONENT);
  });

  test('error text is readable on both surfaces', () => {
    expect(contrast(c.danger, c.background)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(c.danger, c.card)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // WCAG 1.4.11: an input is identified by its outline, so the outline itself
  // is a meaningful graphical element.
  test('an input outline is findable on both surfaces', () => {
    expect(contrast(c.border, c.background)).toBeGreaterThanOrEqual(AA_COMPONENT);
    expect(contrast(c.border, c.card)).toBeGreaterThanOrEqual(AA_COMPONENT);
  });

  test('the card divider is perceptible against the card', () => {
    expect(contrast(c.divider, c.card)).toBeGreaterThanOrEqual(VISIBLE_DIVIDER);
  });
});

test('both themes define exactly the same tokens', () => {
  expect(Object.keys(Colors.dark).sort()).toEqual(Object.keys(Colors.light).sort());
});
