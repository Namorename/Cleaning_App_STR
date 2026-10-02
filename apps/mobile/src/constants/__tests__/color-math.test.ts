import {
  compositeOver,
  contrastRatio,
  deltaE,
  minDeficiencyDeltaE,
  underVeil,
  veiledContrast,
} from '../../../../../packages/shared/src/testing/color-math';

/**
 * The guards are only as good as their arithmetic, and the arithmetic has to be
 * the comparison page's: the owner chose «Абрикос» looking at the numbers the
 * page printed (docs/design/redesign-directions.html, "colour math"), and a
 * guard that measures differently would pass or fail colours he never saw.
 *
 * Each anchor below is a number printed in a document of the redesign — the
 * decisions (docs/design/decisions.md §3), the plan (§8 p.4) or the dataviz
 * validator's output embedded in the page — recomputed here from the hex.
 * Printed numbers are rounded to two places (contrast) or one (ΔE), so the
 * anchors compare at that precision; the guards themselves never round.
 */
describe('WCAG contrast', () => {
  test('black on white is the scale’s ceiling', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
  });

  test('is symmetric', () => {
    expect(contrastRatio('#983512', '#fffcfb')).toBe(contrastRatio('#fffcfb', '#983512'));
  });

  test('the old main button label: 7.21 light, 7.16 dark (decisions §3)', () => {
    expect(contrastRatio('#fffcfb', '#983512')).toBeCloseTo(7.21, 2);
    expect(contrastRatio('#1e1511', '#e78c70')).toBeCloseTo(7.16, 2);
  });

  test('the new main button label: 16.69 light, 17.57 dark (decisions §3)', () => {
    expect(contrastRatio('#fffcfb', '#3a0c00')).toBeCloseTo(16.69, 2);
    expect(contrastRatio('#1e1511', '#fffcfb')).toBeCloseTo(17.57, 2);
  });

  test('rejects anything but #rrggbb', () => {
    expect(() => contrastRatio('#fff', '#000000')).toThrow('#rrggbb');
  });
});

describe('the white 40 % veil of the «Солнце» toggle', () => {
  test('lifts black to #666666 (decisions §3)', () => {
    expect(underVeil('#000000')).toBe('#666666');
  });

  test('white on black under it: 5.74 (decisions §3)', () => {
    expect(veiledContrast('#ffffff', '#000000')).toBeCloseTo(5.74, 2);
  });

  test('the old label on terracotta under it: 3.00 (plan §8 p.4)', () => {
    expect(veiledContrast('#fffcfb', '#983512')).toBeCloseTo(3.0, 2);
  });

  test('the new main button under it: 4.66 light, 4.62 dark (decisions §3)', () => {
    expect(veiledContrast('#fffcfb', '#3a0c00')).toBeCloseTo(4.66, 2);
    expect(veiledContrast('#1e1511', '#fffcfb')).toBeCloseTo(4.62, 2);
  });

  test('a lighter main button would hold 4.53 only (decisions §3)', () => {
    expect(veiledContrast('#fffcfb', '#420e00')).toBeCloseTo(4.53, 2);
  });

  test('composites in sRGB and rounds to 8 bits, as a browser paints', () => {
    expect(compositeOver('#1e1511', 0.64, '#ffffff')).toBe('#6f6967');
  });
});

describe('OKLab ΔE with the Machado 2009 simulation', () => {
  test('the new main button is one step deeper than the ramp’s end: 3.8 (decisions §3)', () => {
    expect(deltaE('#3a0c00', '#381b12')).toBeCloseTo(3.8, 1);
  });

  test('light calendar dots: worst normal pair 18.3 (validator, set «dots»)', () => {
    expect(deltaE('#754197', '#1f81c9')).toBeCloseTo(18.3, 1);
  });

  test('light calendar dots: worst protan pair 8.5 (validator, set «dots»)', () => {
    expect(deltaE('#007a4f', '#af7c00', 'protan')).toBeCloseTo(8.5, 1);
  });

  test('dark calendar dots: worst deutan pair 8.8 (validator, set «dots»)', () => {
    expect(deltaE('#44ab6d', '#c38600', 'deutan')).toBeCloseTo(8.8, 1);
  });

  test('light step circles: 15.3 normal, 6.3 protan (validator, set «steps»)', () => {
    expect(deltaE('#007a4f', '#8b7c76')).toBeCloseTo(15.3, 1);
    expect(deltaE('#007a4f', '#8b7c76', 'protan')).toBeCloseTo(6.3, 1);
  });

  test('the deficiency distance is the worst of the three simulations', () => {
    const pair = ['#007a4f', '#af7c00'] as const;
    const each = (['protan', 'deutan', 'tritan'] as const).map((kind) => deltaE(...pair, kind));
    expect(minDeficiencyDeltaE(...pair)).toBe(Math.min(...each));
  });
});
