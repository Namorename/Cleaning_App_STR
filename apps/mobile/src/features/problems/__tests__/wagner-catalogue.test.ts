import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  categoryLevel,
  inPickOrder,
  indexCategories,
  matchCategories,
  problemCategoryListSchema,
  type ProblemCategory,
} from '../categories';

/**
 * CLIENT:Wagnerstays — the client's catalogue as its one-off script loads it
 * (docs/one-off-writes/wagner-problem-categories.sql): the number the owner gave,
 * the order, the translations, and the core search (categories.test.ts) on the
 * list the phones will get, word for word, the owner's own example included.
 * Retire this file with the script, should the script ever move.
 */

const SCRIPT = readFileSync(
  join(__dirname, '../../../../../../docs/one-off-writes/wagner-problem-categories.sql'),
  'utf8',
);

/** ('<uuid>', 'P1',  1, 'Горячая вода',\n '{"en": …}', '{бойлер}') */
const ROW =
  /\('([0-9a-f-]{36})', '(P[1-4])',\s*(\d+), '([^']+)',\s*'(\{[^']*\})',\s*'\{([^']*)\}'\)/g;

/** The script's `levels` block: ('P1', 'high'::public.problem_priority, true) */
const LEVEL =
  /\('(P[1-4])', '(low|normal|high)'::public\.problem_priority, (true|false)\)/g;

const levels = new Map(
  [...SCRIPT.matchAll(LEVEL)].map((match) => [
    match[1],
    { priority: match[2] as 'low' | 'normal' | 'high', critical: match[3] === 'true' },
  ]),
);

interface ScriptRow {
  readonly level: string;
  readonly sortOrder: number;
  readonly category: ProblemCategory;
}

const rows: ScriptRow[] = [...SCRIPT.matchAll(ROW)].map((match) => ({
  level: match[2],
  sortOrder: Number(match[3]),
  category: {
    id: match[1],
    name: match[4],
    name_i18n: JSON.parse(match[5]) as Record<string, string>,
    synonyms: match[6] === '' ? [] : match[6].split(','),
    // The urgency is the owner's decision, the script's `levels` block.
    priority: levels.get(match[2])?.priority ?? null,
    critical: levels.get(match[2])?.critical ?? false,
  },
}));
const catalogue = rows.map((row) => row.category);
const index = indexCategories(catalogue);

const found = (query: string): string[] =>
  matchCategories(index, query).map((category) => category.name);

describe("the client's catalogue as the script loads it", () => {
  test('holds 27 categories', () => {
    expect(rows).toHaveLength(27);
  });

  test('P1 6, P2 7, P3 6, P4 8, in the order the owner gave', () => {
    const count = (level: string) => rows.filter((row) => row.level === level).length;
    expect([count('P1'), count('P2'), count('P3'), count('P4')]).toEqual([6, 7, 6, 8]);
    expect(rows.map((row) => row.sortOrder)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
    expect(rows.map((row) => row.level)).toEqual([...rows.map((row) => row.level)].sort());
  });

  test('files P1 critical, P2 high, P3 normal, P4 low: as the owner mapped them on 2026-11-15', () => {
    expect(levels.size).toBe(4);
    const levelOf = (level: string) =>
      [...new Set(rows.filter((row) => row.level === level).map((row) => categoryLevel(row.category)))];
    expect([levelOf('P1'), levelOf('P2'), levelOf('P3'), levelOf('P4')]).toEqual([
      ['critical'],
      ['high'],
      ['normal'],
      ['low'],
    ]);
  });

  test('she picks from P4 on top down to P1 at the bottom, as the owner ordered each level', () => {
    const picked = inPickOrder(catalogue).map((category) => category.name);
    expect(picked.slice(0, 2)).toEqual(['Косметические дефекты', 'Царапины']);
    expect(picked.slice(-2)).toEqual(['Прорыв труб', 'Затопление']);
    expect(picked.indexOf('Декор')).toBeLessThan(picked.indexOf('Горячая вода'));
  });

  test('six critical, seven high, six normal, eight low', () => {
    const count = (level: string) =>
      catalogue.filter((category) => categoryLevel(category) === level).length;
    expect([count('critical'), count('high'), count('normal'), count('low')]).toEqual([6, 7, 6, 8]);
  });

  test('names each one in Russian, English and Czech, every name once', () => {
    for (const category of catalogue) {
      expect(category.name.trim()).not.toBe('');
      expect(category.name_i18n.en?.trim()).toBeTruthy();
      expect(category.name_i18n.cs?.trim()).toBeTruthy();
    }
    expect(new Set(catalogue.map((category) => category.name.toLowerCase())).size).toBe(27);
  });

  test("reads through the phone's schema as it is", () => {
    expect(problemCategoryListSchema.parse(catalogue)).toEqual(catalogue);
  });

  test('every synonym is a lower-case word or two, none empty', () => {
    for (const synonym of catalogue.flatMap((category) => category.synonyms)) {
      expect(synonym).toBe(synonym.toLowerCase());
      expect(synonym.trim()).toBe(synonym);
      expect(synonym).not.toBe('');
    }
  });

  test('every category is found by the first letters of its own name, in each language', () => {
    for (const category of catalogue) {
      for (const name of [category.name, category.name_i18n.en, category.name_i18n.cs]) {
        expect(found(name.slice(0, 3))).toContain(category.name);
      }
    }
  });
});

describe('the search', () => {
  test("nothing typed: every category, in the catalogue's order", () => {
    expect(found('')).toEqual(catalogue.map((category) => category.name));
    expect(found('   ')).toHaveLength(27);
  });

  test("finds by the beginning of any word, as in the owner's example", () => {
    expect(found('элек')).toEqual([
      'Электричество полностью',
      'Частичное отсутствие электричества',
    ]);
  });

  test('ignores case', () => {
    expect(found('ЭЛЕК')).toEqual(found('элек'));
    expect(found('Горяч')).toEqual(['Горячая вода']);
  });

  test('reads ё as е, both ways', () => {
    expect(found('белье')).toEqual(['Доставка (бельё, химия, кроватка и т. д.)']);
    expect(found('бельё')).toEqual(['Доставка (бельё, химия, кроватка и т. д.)']);
  });

  test('finds by a synonym', () => {
    expect(found('кран')).toEqual(['Смесители']);
    expect(found('кондер')).toEqual(['Кондиционер']);
    expect(found('вайфай')).toEqual(['Wi-Fi']);
    expect(found('wifi')).toEqual(['Wi-Fi']);
    expect(found('интер')).toEqual(['Wi-Fi']);
  });

  test('takes «Wi-Fi» and «вай-фай» as two words each', () => {
    expect(found('wi-fi')).toEqual(['Wi-Fi']);
    expect(found('вай-фай')).toEqual(['Wi-Fi']);
    expect(found('fi')).toEqual(['Wi-Fi']);
  });

  test("wants every word typed, each the start of one of the category's words", () => {
    expect(found('гор вод')).toEqual(['Горячая вода']);
    expect(found('вод гор')).toEqual(['Горячая вода']);
    expect(found('элек полн')).toEqual(['Электричество полностью']);
    expect(found('частич элек')).toEqual(['Частичное отсутствие электричества']);
    expect(found('гор стул')).toEqual([]);
  });

  test('matches the start of a word, never its middle', () => {
    expect(found('ода')).toEqual([]);
    expect(found('вод')).toEqual(['Горячая вода']);
  });

  test('a word shared by categories finds them all, in order', () => {
    expect(found('мебел')).toEqual(['Мебель', 'Замена мебели']);
    expect(found('свет')).toEqual([
      'Электричество полностью',
      'Частичное отсутствие электричества',
      'Освещение',
    ]);
  });

  test('finds by the English and Czech names too, diacritics aside', () => {
    expect(found('hot')).toEqual(['Горячая вода']);
    expect(found('tepla')).toEqual(['Горячая вода']);
    expect(found('teplá')).toEqual(['Горячая вода']);
  });

  test('punctuation she types is not a word', () => {
    expect(found('доставка (')).toEqual(['Доставка (бельё, химия, кроватка и т. д.)']);
    expect(found('...')).toHaveLength(27);
  });

  test('a word nobody wrote finds nothing', () => {
    expect(found('zzz')).toEqual([]);
  });
});
