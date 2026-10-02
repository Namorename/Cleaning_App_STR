/**
 * Colour arithmetic for the design guards: WCAG 2.x contrast, the white veil
 * of the «Солнце» toggle, and the OKLab distance with the Machado 2009
 * colour-vision simulation.
 *
 * The formulas are the comparison page's ("colour math" in
 * docs/design/redesign-directions.html), which in turn are the dataviz
 * validator's the statuses were tuned with. A guard therefore prints the
 * number the owner saw when he chose the palette. Nothing here rounds a ratio:
 * 4.499 does not pass 4.5. The one rounding is the page's own — a composite
 * colour is an 8-bit colour, as a browser paints it.
 *
 * Test-only, like the rest of `testing/`: the apps never measure colour at run
 * time, so this is not exported from the package.
 */

/** sRGB channels in 0..1. */
export type Rgb = readonly [number, number, number];
export type Deficiency = 'protan' | 'deutan' | 'tritan';
type Matrix = readonly [Rgb, Rgb, Rgb];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const WHITE = '#ffffff';

/** The veil of the «Солнце» toggle: white at 40 % over every colour (decisions §3). */
export const VEIL_ALPHA = 0.4;

export const DEFICIENCIES: readonly Deficiency[] = ['protan', 'deutan', 'tritan'];

/**
 * Machado, Oliveira & Fernandes 2009 at full severity, applied in linear RGB —
 * the matrices of the page and of its SVG filters.
 */
const MACHADO: Readonly<Record<Deficiency, Matrix>> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function hexToRgb(hex: string): Rgb {
  if (!HEX_COLOR.test(hex)) {
    throw new Error(`Expected a colour as #rrggbb, got ${hex}`);
  }
  const channel = (start: number): number => parseInt(hex.slice(start, start + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

function rgbToHex(rgb: Rgb): string {
  const byte = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${rgb.map(byte).join('')}`;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearRgb(hex: string): Rgb {
  const [r, g, b] = hexToRgb(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21, unrounded. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `top` at `alpha` over `under`, composited in sRGB and rounded to 8 bits. */
export function compositeOver(top: string, alpha: number, under: string): string {
  const t = hexToRgb(top);
  const u = hexToRgb(under);
  const mix = (i: 0 | 1 | 2): number => t[i] * alpha + u[i] * (1 - alpha);
  return rgbToHex([mix(0), mix(1), mix(2)]);
}

/** A colour as it reads on the street: under the white 40 % veil. */
export function underVeil(hex: string): string {
  return compositeOver(WHITE, VEIL_ALPHA, hex);
}

/** The contrast of a pair when both colours are under the veil. */
export function veiledContrast(fg: string, bg: string): number {
  return contrastRatio(underVeil(fg), underVeil(bg));
}

function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function simulate(hex: string, deficiency: Deficiency): Rgb {
  const [r, g, b] = linearRgb(hex);
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const [row0, row1, row2] = MACHADO[deficiency];
  const apply = (row: Rgb): number => clamp(row[0] * r + row[1] * g + row[2] * b);
  return [apply(row0), apply(row1), apply(row2)];
}

/** OKLab distance × 100; with a deficiency, both colours as that eye sees them. */
export function deltaE(a: string, b: string, deficiency?: Deficiency): number {
  const pa = oklab(deficiency === undefined ? linearRgb(a) : simulate(a, deficiency));
  const pb = oklab(deficiency === undefined ? linearRgb(b) : simulate(b, deficiency));
  return 100 * Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
}

/** The distance of a pair for the eye that tells them apart worst. */
export function minDeficiencyDeltaE(a: string, b: string): number {
  return Math.min(...DEFICIENCIES.map((deficiency) => deltaE(a, b, deficiency)));
}
