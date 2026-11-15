import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  categoryName,
  indexCategories,
  matchCategories,
  problemCategoryListSchema,
  type ProblemCategory,
} from '../categories';

/**
 * The search of the catalogue, against the client's own list: the categories
 * are read off the one-off script that loads them
 * (docs/one-off-writes/wagner-problem-categories.sql), so the list tested here
 * is the list the phones will get, word for word.
 */

const SCRIPT = readFileSync(
  join(__dirname, '../../../../../../docs/one-off-writes/wagner-problem-categories.sql'),
  'utf8',
);

/** ('<uuid>', 'P1',  1, 'Горячая вода',\n '{"en": …}', '{бойлер}') */
const ROW =
  /\('([0-9a-f-]{36})', '(P[1-4])',\s*(\d+), '([^']+)',\s*'(\{[^']*\})',\s*'\{([^']*)\}'\)/g;

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
    // The urgency is the owner's decision (the script's `levels` block); the
    // search does not read it.
    priority: null,
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

describe('the name she reads', () => {
  const hotWater = catalogue[0];

  test('is the translation in her language', () => {
    expect(categoryName(hotWater, 'en')).toBe('Hot water');
    expect(categoryName(hotWater, 'cs')).toBe('Teplá voda');
  });

  test("is the company's words where there is no translation", () => {
    expect(categoryName(hotWater, 'ru')).toBe('Горячая вода');
    expect(categoryName({ ...hotWater, name_i18n: { en: '  ' } }, 'en')).toBe('Горячая вода');
  });
});

describe('the schema of a category', () => {
  const raw = {
    id: '83ffda56-635c-4941-bedd-cb08b82e6675',
    name: 'Горячая вода',
    name_i18n: { en: 'Hot water' },
    synonyms: ['бойлер'],
    priority: 'high',
  };

  test('reads a row of the server', () => {
    expect(problemCategoryListSchema.parse([raw])[0].priority).toBe('high');
  });

  test('an urgency a newer server invents reads as unknown, not as a broken list', () => {
    const [category] = problemCategoryListSchema.parse([{ ...raw, priority: 'critical' }]);
    expect(category.priority).toBeNull();
    expect(category.name).toBe('Горячая вода');
  });

  test('odd translations or synonyms cost themselves, not the category', () => {
    const [category] = problemCategoryListSchema.parse([{ ...raw, name_i18n: 3, synonyms: null }]);
    expect(category.name_i18n).toEqual({});
    expect(category.synonyms).toEqual([]);
  });
});
