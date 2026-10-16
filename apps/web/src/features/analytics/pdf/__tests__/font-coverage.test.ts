// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { fitToFont, isInReportFont, REPORT_FONT_RANGES } from '../font-coverage';
import { PUBLIC_FONTS } from '../fonts';

/**
 * fontkit, the renderer's own font reader, reached the way the renderer
 * reaches it — @react-pdf/renderer → @react-pdf/font → fontkit — not by
 * whatever the install happened to hoist.
 */
interface FontkitFont {
  characterSet: number[];
}
const fromRenderer = createRequire(createRequire(import.meta.url).resolve('@react-pdf/renderer'));
const fontkit = createRequire(fromRenderer.resolve('@react-pdf/font'))('fontkit') as {
  create: (data: Buffer) => FontkitFont;
};

/** Every string under the given keys of a locale file, placeholders left out. */
function stringsUnder(file: string, keys: readonly string[]): string[] {
  const locale: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../../../../packages/shared/src/i18n/locales/${file}`, import.meta.url)), 'utf8'),
  );
  const walk = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value.replace(/\{\{[^}]*\}\}/g, '')]
      : value !== null && typeof value === 'object'
        ? Object.values(value).flatMap(walk)
        : [];
  return keys.flatMap((key) =>
    walk(key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], locale)),
  );
}

/** The code points a font maps, as [first, last] runs. */
function runsOf(codePoints: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const point of [...codePoints].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last !== undefined && last[1] === point - 1) {
      last[1] = point;
    } else {
      runs.push([point, point]);
    }
  }
  return runs;
}

describe('the report font’s letters', () => {
  test.each(Object.entries(PUBLIC_FONTS))('the table is the %s file’s own map', (_, path) => {
    const file = fileURLToPath(new URL(`../../../../../public${path}`, import.meta.url));
    const font = fontkit.create(readFileSync(file));
    expect(runsOf(font.characterSet)).toEqual(REPORT_FONT_RANGES);
  });

  test('Czech and Cyrillic letters and the report’s signs are in it; emoji are not', () => {
    const has = (text: string) => [...text].every((letter) => isInReportFont(letter.codePointAt(0) ?? 0));
    expect(has('Příliš žluťoučký kůň ÚĚŠČŘŽÝÁÍÉŮ')).toBe(true);
    expect(has('Съешь же ещё этих мягких французских булок ЁЙ№')).toBe(true);
    expect(has('–—…·«»€%\u00a0')).toBe(true);
    expect(has('🏠')).toBe(false);
    expect(has('→')).toBe(false);
    expect(has('★')).toBe(false);
  });

  // The report's own words must never lose a letter to fitToFont: a translation
  // with a sign the font has not fails here, not silently in a PDF.
  test.each(['en.json', 'cs.json', 'ru.json'])('every word the report takes from %s is in the font', (file) => {
    const words = stringsUnder(file, [
      'panel.analytics',
      'panel.tasks.statuses',
      'problems.statuses',
      'problems.priorities',
    ]);
    expect(words.length).toBeGreaterThan(100);
    const outside = words.flatMap((word) =>
      [...word.normalize('NFC')].filter((letter) => !isInReportFont(letter.codePointAt(0) ?? 0)),
    );
    expect(outside).toEqual([]);
  });
});

describe('fitToFont', () => {
  test('a text the font draws whole stays as it is', () => {
    expect(fitToFont('Žlutý dům · Старый город, 3–4')).toBe('Žlutý dům · Старый город, 3–4');
  });

  test('emoji and signs the font has not are left out, and the spaces around them closed', () => {
    expect(fitToFont('Old Town ★ flat 🏠')).toBe('Old Town flat');
    expect(fitToFont('🌻Sunny loft')).toBe('Sunny loft');
    expect(fitToFont('Praha → Brno')).toBe('Praha Brno');
  });

  test('a sequence of emoji goes whole: joiners, skin tones, variation selectors and flags', () => {
    expect(fitToFont('Family 👩‍👩‍👧 suite')).toBe('Family suite');
    expect(fitToFont('Love ❤️ nest 👍🏽')).toBe('Love nest');
    expect(fitToFont('🇨🇿 Česko')).toBe('Česko');
  });

  test('a letter written as a base and a mark becomes the one letter the font has', () => {
    expect(fitToFont('Dvor\u030Cák')).toBe('Dvořák');
  });

  test('a space the font has not becomes one it has, still unbroken where it was', () => {
    expect(fitToFont('8:41\u202FPM')).toBe('8:41\u00a0PM');
    expect(fitToFont('a\u2003b')).toBe('a b');
  });

  test('a letter the font has only in parts is kept in parts', () => {
    // g with an acute: the font has no «ǵ», but it has the «g» and the mark.
    expect(fitToFont('Bog\u0301ota')).toBe('Bog\u0301ota');
  });

  test('a control character is a space, a byte order mark nothing', () => {
    expect(fitToFont('Old\rTown\tflat\n')).toBe('Old Town flat');
    expect(fitToFont('\uFEFFLoft')).toBe('Loft');
  });

  test('a name of nothing but emoji is a dash, never an empty cell', () => {
    expect(fitToFont('🏠🏠')).toBe('—');
    expect(fitToFont('')).toBe('');
  });
});
