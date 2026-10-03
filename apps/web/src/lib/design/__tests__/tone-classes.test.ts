import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { RADIUS, THEME_COLORS, TONE_COLORS, TONE_NAMES } from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

import { hatchImage } from '../hatch';
import { renderThemeCss, toneVarName } from '../theme-css';
import { TONE_BADGE, TONE_MARK_BG } from '../tone-classes';

/**
 * A tone's class names a colour only if the generator wrote one under that
 * name; a misspelt tone in a class compiles, passes every other test and
 * draws nothing. So every `*-tone-*` class in the panel's source is held
 * to the generated colours here.
 */

const SRC = path.resolve(__dirname, '../../..');
const GENERATED = renderThemeCss({
  themes: THEME_COLORS,
  tones: TONE_COLORS,
  toneNames: TONE_NAMES,
  radius: RADIUS,
});
const UTILITY =
  /(?<![\w-])(?:bg|text|border|ring|inset-ring|outline|fill|stroke)-(tone-[a-z]+(?:-[a-z]+)*)/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(full);
    }
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('the tone classes', () => {
  test('every tone has a mark and a chip', () => {
    expect(Object.keys(TONE_MARK_BG).sort()).toEqual([...TONE_NAMES].sort());
    expect(Object.keys(TONE_BADGE).sort()).toEqual([...TONE_NAMES].sort());
    for (const tone of TONE_NAMES) {
      expect(TONE_MARK_BG[tone]).toBe(`bg-${toneVarName(tone, 'mark').slice(2)}`);
    }
  });

  test('every tone class in the panel names a colour the generator wrote', () => {
    const used = new Map<string, string>();
    for (const file of sources(SRC)) {
      for (const found of readFileSync(file, 'utf8').matchAll(UTILITY)) {
        used.set(found[1], path.relative(SRC, file));
      }
    }

    expect(used.size).toBeGreaterThan(0);
    for (const [name, file] of used) {
      expect(GENERATED, `${name} in ${file}`).toContain(`--color-${name}: var(--${name});`);
    }
  });

  test('the hatches slant as the contract says, in their tones’ colours', () => {
    expect(hatchImage('notHappened')).toMatch(
      /^repeating-linear-gradient\(45deg, var\(--tone-not-happened-hatch\)/,
    );
    expect(hatchImage('block')).toMatch(
      /^repeating-linear-gradient\(135deg, var\(--tone-block-hatch\)/,
    );
  });
});
