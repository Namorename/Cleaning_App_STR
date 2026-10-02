import type { HexColor, ThemeColors, ThemeName, Tone, ToneColors } from '@str-ops/shared';

/**
 * The panel's theme as CSS, written from the shared tokens (5.2).
 *
 * The panel's screens speak shadcn's names (`bg-background`,
 * `text-muted-foreground`, `border-input`…); this module gives those names the
 * roles of «Абрикос» in both themes, adds the honey accent under a name of its
 * own (`--highlight`: shadcn's `--accent` is the hover and the active menu
 * item) and the thirteen status tones as `--tone-<tone>-<part>`, with Tailwind
 * colours over them (`bg-tone-in-progress-mark`, `text-tone-unassigned-fg`).
 *
 * `npm run design:css` (`scripts/gen-theme-css.mts`) writes the result to
 * `src/app/theme.generated.css`, which `globals.css` imports; a test fails
 * while the committed file differs from what this module writes now. Only type
 * imports here and no other module: the script runs this file under Node's type
 * stripping, which resolves no workspace package and no extensionless path.
 *
 * Three blocks: `:root` is light, `.dark` is the manager's dark, and the
 * system's dark applies while the manager has not chosen light
 * (`:root:not(.light)` under `prefers-color-scheme: dark`). The server puts
 * `light` or `dark` on `<html>` from the theme cookie, or nothing for «as the
 * system», so the first paint is already in the right colours.
 */

export interface DesignTokens {
  readonly themes: Readonly<Record<ThemeName, ThemeColors>>;
  readonly tones: Readonly<Record<ThemeName, Readonly<Record<Tone, ToneColors>>>>;
  readonly toneNames: readonly Tone[];
  readonly radius: { readonly md: number };
}

export type TonePart = keyof ToneColors;

/** The parts of a tone, in the order they are written. */
export const TONE_PARTS = [
  'fg',
  'bg',
  'border',
  'mark',
  'onMark',
  'hatch',
] as const satisfies readonly TonePart[];

type ColorRole = Exclude<keyof ThemeColors, 'scrimAlpha'>;

/** A colour of the theme: one of its roles, or one part of a tone. */
type ColorSource = ColorRole | readonly [Tone, TonePart];

/**
 * shadcn's variables and what each takes. `--muted-foreground` is
 * `textSecondary`: shadcn draws descriptions, captions, placeholders and the
 * panel's every meta line with it — secondary text, not the disabled label
 * `textMuted` is for. `--input` is a field's outline (≥ 3:1), `--border` the
 * hairlines. The phone's main button (`cta*`) is not the panel's.
 */
const SHADCN_COLORS: readonly (readonly [string, ColorSource])[] = [
  ['background', 'bg'],
  ['foreground', 'text'],
  ['card', 'surface'],
  ['card-foreground', 'text'],
  ['popover', 'surface'],
  ['popover-foreground', 'text'],
  ['primary', 'primary'],
  ['primary-foreground', 'onPrimary'],
  ['secondary', 'secondary'],
  ['secondary-foreground', 'onSecondary'],
  ['muted', 'surfaceAlt'],
  ['muted-foreground', 'textSecondary'],
  ['accent', 'surfaceAlt'],
  ['accent-foreground', 'text'],
  ['destructive', 'danger'],
  ['border', 'divider'],
  ['input', 'border'],
  ['ring', 'focusRing'],
  ['highlight', 'accent'],
  ['highlight-foreground', 'onAccent'],
  // Charts: nothing draws one yet; the first five colours a chart would need.
  ['chart-1', 'primary'],
  ['chart-2', 'accent'],
  ['chart-3', ['assigned', 'mark']],
  ['chart-4', ['done', 'mark']],
  ['chart-5', ['unassigned', 'mark']],
  ['sidebar', 'surface'],
  ['sidebar-foreground', 'text'],
  ['sidebar-primary', 'primary'],
  ['sidebar-primary-foreground', 'onPrimary'],
  ['sidebar-accent', 'surfaceAlt'],
  ['sidebar-accent-foreground', 'text'],
  ['sidebar-border', 'divider'],
  ['sidebar-ring', 'focusRing'],
];

/** The names this module adds to Tailwind's colours, besides the tones. */
const NEW_COLORS = ['highlight', 'highlight-foreground'] as const;

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** `('inProgress', 'onMark')` → `--tone-in-progress-on-mark`. */
export function toneVarName(tone: Tone, part: TonePart): string {
  return `--tone-${kebab(tone)}-${kebab(part)}`;
}

/** The tone's colour as a CSS value, for a style or a gradient. */
export function toneVar(tone: Tone, part: TonePart): string {
  return `var(${toneVarName(tone, part)})`;
}

/** The parts a tone has; both themes must have the same ones. */
function partsOf(tokens: DesignTokens, tone: Tone): TonePart[] {
  const has = (theme: ThemeName, part: TonePart): boolean =>
    tokens.tones[theme][tone][part] !== undefined;
  return TONE_PARTS.filter((part) => {
    if (has('light', part) !== has('dark', part)) {
      throw new Error(`Tone ${tone} has ${part} in one theme only`);
    }
    return has('light', part);
  });
}

function colorOf(tokens: DesignTokens, theme: ThemeName, source: ColorSource): HexColor {
  if (typeof source === 'string') {
    return tokens.themes[theme][source];
  }
  const [tone, part] = source;
  const value = tokens.tones[theme][tone][part];
  if (value === undefined) {
    throw new Error(`Tone ${tone} has no ${part}`);
  }
  return value;
}

function line(name: string, value: string): string {
  return `  ${name}: ${value};`;
}

function themeLines(tokens: DesignTokens, theme: ThemeName): string[] {
  const shadcn = SHADCN_COLORS.map(([name, source]) =>
    line(`--${name}`, colorOf(tokens, theme, source)),
  );
  const tones = tokens.toneNames.flatMap((tone) =>
    partsOf(tokens, tone).map((part) =>
      line(toneVarName(tone, part), colorOf(tokens, theme, [tone, part])),
    ),
  );
  return [line('color-scheme', theme), ...shadcn, ...tones];
}

function tailwindLines(tokens: DesignTokens): string[] {
  const added = NEW_COLORS.map((name) => line(`--color-${name}`, `var(--${name})`));
  const tones = tokens.toneNames.flatMap((tone) =>
    partsOf(tokens, tone).map((part) => {
      const name = toneVarName(tone, part);
      return line(`--color-${name.slice(2)}`, `var(${name})`);
    }),
  );
  return [...added, ...tones];
}

function indent(lines: readonly string[]): string[] {
  return lines.map((text) => `  ${text}`);
}

const HEADER = [
  '/*',
  ' * Generated by `npm run design:css` (scripts/gen-theme-css.mts) from',
  ' * packages/shared/src/design/tokens.ts. Do not edit by hand: change the tokens',
  ' * and run the script. apps/web/src/lib/design/__tests__/theme-css.test.ts fails',
  ' * while this file differs from what the script writes.',
  ' */',
];

export function renderThemeCss(tokens: DesignTokens): string {
  const dark = themeLines(tokens, 'dark');
  return [
    ...HEADER,
    '',
    '@theme inline {',
    ...tailwindLines(tokens),
    '}',
    '',
    ':root {',
    line('--radius', `${tokens.radius.md}px`),
    ...themeLines(tokens, 'light'),
    '}',
    '',
    '.dark {',
    ...dark,
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not(.light) {',
    ...indent(dark),
    '  }',
    '}',
    '',
  ].join('\n');
}
