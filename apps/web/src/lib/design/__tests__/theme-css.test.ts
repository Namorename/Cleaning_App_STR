import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FONT,
  RADIUS,
  THEME_COLORS,
  THEME_NAMES,
  TONE_COLORS,
  TONE_NAMES,
  type ThemeColors,
  type ThemeName,
  type ToneColors,
} from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

import { renderThemeCss, toneVarName, TONE_PARTS, type DesignTokens } from '../theme-css';

/**
 * The panel's colours are not written by hand: `npm run design:css` writes
 * `src/app/theme.generated.css` from the shared tokens, under shadcn's names,
 * so the screens keep the classes they have. These guards fail when the
 * committed file is not what the generator would write today (a token changed
 * and nobody ran the script), when a name shadcn's classes read has no value
 * in one of the three blocks, and when the mapping drifts from the plan
 * (docs/redesign-plan.md, 2.2 «Панель»).
 */

const APP = path.resolve(__dirname, '../../../app');
const GENERATED = path.join(APP, 'theme.generated.css');
const GLOBALS = path.join(APP, 'globals.css');

const TOKENS: DesignTokens = {
  themes: THEME_COLORS,
  tones: TONE_COLORS,
  toneNames: TONE_NAMES,
  radius: RADIUS,
};

/** The light theme, the forced dark one and the system's dark. */
const OPENERS = {
  light: ':root {',
  dark: '.dark {',
  systemDark: ':root:not(.light) {',
} as const;

function read(file: string): string {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/** The custom properties one rule of `css` declares, by name. */
function declarations(css: string, opener: string): Map<string, string> {
  const start = css.indexOf(opener);
  expect(start, `no rule «${opener}»`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start + opener.length, css.indexOf('}', start));
  return new Map(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((found) => [found[1], found[2].trim()]),
  );
}

/** The `@theme inline` blocks of `css`, as one string. */
function themeBlocks(css: string): string {
  return [...css.matchAll(/@theme inline \{([^}]*)\}/g)].map((found) => found[1]).join('\n');
}

/** shadcn's name → the role of the tokens it takes (the plan, 2.2). */
const EXPECTED_ROLES: readonly (readonly [string, keyof ThemeColors])[] = [
  ['--background', 'bg'],
  ['--foreground', 'text'],
  ['--card', 'surface'],
  ['--card-foreground', 'text'],
  ['--popover', 'surface'],
  ['--popover-foreground', 'text'],
  ['--primary', 'primary'],
  ['--primary-foreground', 'onPrimary'],
  ['--secondary', 'secondary'],
  ['--secondary-foreground', 'onSecondary'],
  ['--muted', 'surfaceAlt'],
  ['--muted-foreground', 'textSecondary'],
  ['--accent', 'surfaceAlt'],
  ['--accent-foreground', 'text'],
  ['--destructive', 'danger'],
  ['--border', 'divider'],
  ['--input', 'border'],
  ['--ring', 'focusRing'],
  ['--highlight', 'accent'],
  ['--highlight-foreground', 'onAccent'],
  ['--sidebar', 'surface'],
  ['--sidebar-foreground', 'text'],
  ['--sidebar-primary', 'primary'],
  ['--sidebar-primary-foreground', 'onPrimary'],
  ['--sidebar-accent', 'surfaceAlt'],
  ['--sidebar-accent-foreground', 'text'],
  ['--sidebar-border', 'divider'],
  ['--sidebar-ring', 'focusRing'],
];

function blocksOf(theme: ThemeName, css: string): Map<string, string>[] {
  return theme === 'light'
    ? [declarations(css, OPENERS.light)]
    : [declarations(css, OPENERS.dark), declarations(css, OPENERS.systemDark)];
}

describe('the generated theme', () => {
  test('the committed file is what `npm run design:css` writes from the tokens today', () => {
    expect(read(GENERATED), 'run `npm run design:css` and commit the file').toBe(
      renderThemeCss(TOKENS),
    );
  });

  test.each(THEME_NAMES)('%s: shadcn’s names take the roles of the plan', (theme) => {
    const css = renderThemeCss(TOKENS);
    for (const block of blocksOf(theme, css)) {
      for (const [name, role] of EXPECTED_ROLES) {
        expect(block.get(name), `${name} → ${role}`).toBe(THEME_COLORS[theme][role]);
      }
    }
  });

  test('the system’s dark is the forced dark, value for value', () => {
    const css = renderThemeCss(TOKENS);
    expect(declarations(css, OPENERS.systemDark)).toEqual(declarations(css, OPENERS.dark));
  });

  test.each(THEME_NAMES)('%s: every tone is drawn with its own colours', (theme) => {
    const css = renderThemeCss(TOKENS);
    for (const block of blocksOf(theme, css)) {
      for (const tone of TONE_NAMES) {
        const colors: ToneColors = TONE_COLORS[theme][tone];
        for (const part of TONE_PARTS) {
          expect(block.get(toneVarName(tone, part)), `${tone}.${part}`).toBe(colors[part]);
        }
      }
    }
  });

  test('the radius is the tokens’ md step', () => {
    const light = declarations(renderThemeCss(TOKENS), OPENERS.light);
    expect(light.get('--radius')).toBe(`${RADIUS.md}px`);
  });

  test('the phone’s main button is not a colour of the panel', () => {
    const values = [...declarations(renderThemeCss(TOKENS), OPENERS.light).values()];
    expect(values).not.toContain(THEME_COLORS.light.cta);
    expect(values).not.toContain(THEME_COLORS.light.ctaPressed);
  });
});

describe('the stylesheet reads only what the theme defines', () => {
  const globals = read(GLOBALS);
  const generated = renderThemeCss(TOKENS);

  test('globals.css takes the generated theme in', () => {
    expect(globals).toContain('@import "./theme.generated.css";');
  });

  test('every variable a utility maps to has a value in light, dark and the system’s dark', () => {
    const referenced = new Set(
      [...themeBlocks(`${globals}\n${generated}`).matchAll(/var\((--[\w-]+)\)/g)].map(
        (found) => found[1],
      ),
    );
    // next/font sets it on <html>, unlayered, over Tailwind's default.
    referenced.delete('--font-sans');
    const light = declarations(generated, OPENERS.light);
    const darks = [
      declarations(generated, OPENERS.dark),
      declarations(generated, OPENERS.systemDark),
    ];

    expect(referenced.size).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(light.has(name), `${name} in light`).toBe(true);
      if (name !== '--radius') {
        for (const dark of darks) {
          expect(dark.has(name), `${name} in dark`).toBe(true);
        }
      }
    }
  });

  test('the dark variant follows the system unless the manager chose light', () => {
    expect(globals).toMatch(/@custom-variant dark \{[\s\S]*prefers-color-scheme: dark[\s\S]*\}/);
  });

  test('the fonts do not point at themselves or at a font nobody loads', () => {
    expect(globals).not.toMatch(/--font-sans:\s*var\(--font-sans\)/);
    expect(globals).not.toContain('--font-geist-mono');
  });
});

/**
 * next/font takes only literal options, so the layout cannot read `FONT`; this
 * reads the layout instead. The variable must sit on <html>, where `font-sans`
 * is read: on <body> the panel stays in the browser's serif (checked in Chrome).
 */
describe('the font', () => {
  const layout = read(path.join(APP, 'layout.tsx'));

  test('is the tokens’ family in the tokens’ weights, with Cyrillic and Czech letters', () => {
    expect(layout).toContain(`from 'next/font/google'`);
    expect(layout).toMatch(new RegExp(`\\b${FONT.family}\\(\\{`));
    const weights = /weight: \[([^\]]*)\]/.exec(layout)?.[1] ?? '';
    expect(weights.split(',').map((one) => Number(one.trim().replace(/'/g, '')))).toEqual(
      FONT.weights,
    );
    expect(layout).toContain(`subsets: ['latin', 'latin-ext', 'cyrillic']`);
    expect(layout).toContain(`variable: '--font-sans'`);
  });

  test('sets its variable on <html>', () => {
    expect(layout).toMatch(/<html[^>]*className=\{[^}]*\.variable/);
  });
});
