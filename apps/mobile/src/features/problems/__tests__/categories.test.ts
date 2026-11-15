import {
  categoryName,
  inPickOrder,
  indexCategories,
  matchCategories,
  problemCategoryListSchema,
  type ProblemCategory,
} from '../categories';

/**
 * The core search of a company's catalogue (categories.ts), on a small list of
 * its own: any company's names, in three languages, with and without synonyms.
 * The client's real list is wagner-catalogue.test.ts.
 */

function category(
  id: number,
  name: string,
  name_i18n: Record<string, string>,
  synonyms: string[] = [],
): ProblemCategory {
  return {
    id: `00000000-0000-4000-8000-0000000000${String(id).padStart(2, '0')}`,
    name,
    name_i18n,
    synonyms,
    priority: 'normal',
  };
}

const CATALOGUE = [
  category(1, 'Горячая вода', { en: 'Hot water', cs: 'Teplá voda' }),
  category(2, 'Электричество полностью', {
    en: 'Total power outage',
    cs: 'Úplný výpadek elektřiny',
  }),
  category(3, 'Частичное отсутствие электричества', { en: 'Partial power outage' }),
  category(4, 'Wi-Fi', { en: 'Wi-Fi' }),
  category(5, 'Air-con', { en: 'Air-con' }),
  category(6, 'Смесители', { en: 'Taps' }, ['кран']),
  category(7, 'Доставка (бельё, химия…)', { en: 'Delivery' }),
  category(8, 'Мебель', { en: 'Furniture' }),
  category(9, 'Замена мебели', { en: 'Furniture replacement' }),
];
const index = indexCategories(CATALOGUE);
const found = (query: string): string[] => matchCategories(index, query).map((item) => item.name);

describe('the search', () => {
  test("nothing typed: every category, in the catalogue's order", () => {
    expect(found('')).toEqual(CATALOGUE.map((item) => item.name));
    expect(found('   ')).toHaveLength(CATALOGUE.length);
  });

  test('the start of any word of a name', () => {
    expect(found('элек')).toEqual([
      'Электричество полностью',
      'Частичное отсутствие электричества',
    ]);
    expect(found('вод')).toEqual(['Горячая вода']);
  });

  test('never the middle of a word', () => {
    expect(found('ода')).toEqual([]);
    expect(found('ктри')).toEqual([]);
  });

  test('whatever the case', () => {
    expect(found('ЭЛЕК')).toEqual(found('элек'));
    expect(found('hOT')).toEqual(['Горячая вода']);
  });

  test('ё and е are one letter, both ways', () => {
    expect(found('белье')).toEqual(['Доставка (бельё, химия…)']);
    expect(found('бельё')).toEqual(['Доставка (бельё, химия…)']);
  });

  test('a synonym finds its category', () => {
    expect(found('кран')).toEqual(['Смесители']);
  });

  test('every word typed must start a word of the category, in any order', () => {
    expect(found('гор вод')).toEqual(['Горячая вода']);
    expect(found('вод гор')).toEqual(['Горячая вода']);
    expect(found('элек полн')).toEqual(['Электричество полностью']);
    expect(found('частич элек')).toEqual(['Частичное отсутствие электричества']);
    expect(found('гор мебел')).toEqual([]);
  });

  test('a word shared by categories finds them all, in order', () => {
    expect(found('мебел')).toEqual(['Мебель', 'Замена мебели']);
  });

  test('a hyphenated name is found by its parts and run together, with no synonym', () => {
    expect(found('wi')).toEqual(['Wi-Fi']);
    expect(found('fi')).toEqual(['Wi-Fi']);
    expect(found('wi-fi')).toEqual(['Wi-Fi']);
    expect(found('wifi')).toEqual(['Wi-Fi']);
    expect(found('aircon')).toEqual(['Air-con']);
  });

  test('the translations are searched too, diacritics aside', () => {
    expect(found('tepla')).toEqual(['Горячая вода']);
    expect(found('teplá')).toEqual(['Горячая вода']);
    expect(found('vypadek')).toEqual(['Электричество полностью']);
    expect(found('furn rep')).toEqual(['Замена мебели']);
  });

  test('punctuation she types, or that a name holds, is not a word', () => {
    expect(found('доставка (')).toEqual(['Доставка (бельё, химия…)']);
    expect(found('химия')).toEqual(['Доставка (бельё, химия…)']);
    expect(found('...')).toHaveLength(CATALOGUE.length);
  });

  test('a word nobody wrote finds nothing', () => {
    expect(found('zzz')).toEqual([]);
  });
});

describe('the name she reads', () => {
  const hotWater = CATALOGUE[0];

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
    // `critical` is no such word: the server keeps that level as high with a flag.
    const [read] = problemCategoryListSchema.parse([{ ...raw, priority: 'urgent' }]);
    expect(read.priority).toBeNull();
    expect(read.name).toBe('Горячая вода');
  });

  test('odd translations or synonyms cost themselves, not the category', () => {
    const [read] = problemCategoryListSchema.parse([{ ...raw, name_i18n: 3, synonyms: null }]);
    expect(read.name_i18n).toEqual({});
    expect(read.synonyms).toEqual([]);
  });
});

describe('the order she picks from (owner, 2026-11-15)', () => {
  const levelled = (
    id: number,
    name: string,
    priority: ProblemCategory['priority'],
    critical = false,
  ): ProblemCategory => ({ ...category(id, name, {}), priority, critical });

  // The catalogue's own order: P1 first, as the client wrote it.
  const BY_CATALOGUE = [
    levelled(1, 'Горячая вода', 'high', true),
    levelled(2, 'Затопление', 'high', true),
    levelled(3, 'Wi-Fi', 'high'),
    levelled(4, 'Плита', 'high'),
    levelled(5, 'Мебель', 'normal'),
    levelled(6, 'Смесители', 'normal'),
    levelled(7, 'Декор', 'low'),
    levelled(8, 'Царапины', 'low'),
  ];

  test('low on top, then normal, high, and critical at the very bottom; the catalogue order within a level', () => {
    expect(inPickOrder(BY_CATALOGUE).map((item) => item.name)).toEqual([
      'Декор',
      'Царапины',
      'Мебель',
      'Смесители',
      'Wi-Fi',
      'Плита',
      'Горячая вода',
      'Затопление',
    ]);
  });

  test('the search answers in the same order, still by the start of a word', () => {
    const withVase = BY_CATALOGUE.map((item) =>
      item.name === 'Декор' ? { ...item, synonyms: ['ваза'] } : item,
    );
    const ordered = indexCategories(inPickOrder(withVase));
    const hit = (query: string) => matchCategories(ordered, query).map((item) => item.name);

    expect(hit('')).toEqual(inPickOrder(withVase).map((item) => item.name));
    // «в»: «Декор» (low, by «ваза») before «Горячая вода» (critical), whatever the catalogue said.
    expect(hit('в')).toEqual(['Декор', 'Горячая вода']);
    // Still the start of a word only.
    expect(hit('ода')).toEqual([]);
  });

  test('a category whose urgency could not be read leads, as one with none', () => {
    const unknown = levelled(9, 'Новая', null);
    expect(inPickOrder([...BY_CATALOGUE, unknown])[0].name).toBe('Новая');
  });

  test('the list is not reordered in place', () => {
    const before = BY_CATALOGUE.map((item) => item.id);
    inPickOrder(BY_CATALOGUE);
    expect(BY_CATALOGUE.map((item) => item.id)).toEqual(before);
  });
});
