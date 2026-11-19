import {
  categoryLevel,
  categoryName,
  indexCategories,
  inPickOrder,
  matchCategories,
  type CatalogCategory,
} from '@str-ops/shared/src/problems/categories';
import { CATALOG_FIXTURE } from '@str-ops/shared/src/testing/problem-categories.fixture';
import { describe, expect, test } from 'vitest';

/**
 * The order and the search of the category picker — the module the panel's «Новое задание»
 * reads, with the rules of the cleaners' phone (owner, 2026-11-15 and 2026-11-20), on the first
 * client's catalogue of 27.
 */

const ordered = inPickOrder(CATALOG_FIXTURE);
const index = indexCategories(ordered);
const found = (query: string) => matchCategories(index, query).map((category) => category.name);

describe('the order of the list', () => {
  test('low on top, then normal and high, critical at the very bottom', () => {
    const levels = ordered.map(categoryLevel);
    expect(levels.slice(0, 8)).toEqual(Array(8).fill('low'));
    expect(levels.slice(8, 14)).toEqual(Array(6).fill('normal'));
    expect(levels.slice(14, 21)).toEqual(Array(7).fill('high'));
    expect(levels.slice(21)).toEqual(Array(6).fill('critical'));
  });

  test('within a level, the catalogue’s own order', () => {
    expect(ordered.slice(0, 3).map((category) => category.name)).toEqual([
      'Косметические дефекты',
      'Царапины',
      'Покраска стен',
    ]);
    expect(ordered.slice(21).map((category) => category.name)).toEqual([
      'Горячая вода',
      'Отопление',
      'Доступ в квартиру',
      'Электричество полностью',
      'Прорыв труб',
      'Затопление',
    ]);
  });

  test('a category whose urgency could not be read leads, and nothing is lost', () => {
    const unknown: CatalogCategory = { ...CATALOG_FIXTURE[0], id: 'x', priority: null };
    const list = inPickOrder([...CATALOG_FIXTURE, unknown]);
    expect(list[0]).toBe(unknown);
    expect(list).toHaveLength(CATALOG_FIXTURE.length + 1);
  });

  test('the catalogue handed in is not reordered in place', () => {
    const before = CATALOG_FIXTURE.map((category) => category.id);
    inPickOrder(CATALOG_FIXTURE);
    expect(CATALOG_FIXTURE.map((category) => category.id)).toEqual(before);
  });
});

describe('the level a category files a task with', () => {
  test('P1 is critical: high with the flag', () => {
    expect(categoryLevel({ priority: 'high', critical: true })).toBe('critical');
  });

  test('the flag counts only over high, as the database holds it', () => {
    expect(categoryLevel({ priority: 'normal', critical: true })).toBe('normal');
    expect(categoryLevel({ priority: 'high', critical: false })).toBe('high');
    expect(categoryLevel({ priority: 'low' })).toBe('low');
    expect(categoryLevel({ priority: null, critical: true })).toBeNull();
  });
});

describe('the name shown', () => {
  test('in the reader’s language, else the company’s words', () => {
    const flood = CATALOG_FIXTURE[5];
    expect(categoryName(flood, 'en')).toBe('Flooding');
    expect(categoryName(flood, 'cs')).toBe('Zatopení');
    expect(categoryName(flood, 'ru')).toBe('Затопление');
    expect(categoryName({ name: 'Декор', name_i18n: { en: '  ' } }, 'en')).toBe('Декор');
  });
});

describe('the search', () => {
  test('nothing typed keeps the whole list, in its order', () => {
    expect(found('')).toEqual(ordered.map((category) => category.name));
    expect(found('   ')).toHaveLength(27);
  });

  test('the first letters of any word of a name', () => {
    expect(found('элек')).toEqual(['Частичное отсутствие электричества', 'Электричество полностью']);
    expect(found('квар')).toEqual(['Доступ в квартиру']);
  });

  test('not the middle of a word', () => {
    expect(found('ектр')).toEqual([]);
    expect(found('ода')).toEqual([]);
  });

  test('case aside', () => {
    expect(found('ЗАТОП')).toEqual(['Затопление']);
    expect(found('зАтОп')).toEqual(['Затопление']);
  });

  test('ё and е are one letter, both ways', () => {
    expect(found('белье')).toEqual(['Доставка (бельё, химия, кроватка и т. д.)']);
    expect(found('бельё')).toEqual(['Доставка (бельё, химия, кроватка и т. д.)']);
  });

  test('a synonym', () => {
    expect(found('кран')).toEqual(['Смесители']);
    expect(found('бойл')).toEqual(['Горячая вода']);
    expect(found('свет')).toEqual([
      'Освещение',
      'Частичное отсутствие электричества',
      'Электричество полностью',
    ]);
  });

  test('several words, each the start of a word, in any order', () => {
    expect(found('гор вод')).toEqual(['Горячая вода']);
    expect(found('вод гор')).toEqual(['Горячая вода']);
    expect(found('замен меб')).toEqual(['Замена мебели']);
    expect(found('гор отоп')).toEqual([]);
  });

  test('a translation, diacritics aside', () => {
    expect(found('flood')).toEqual(['Затопление']);
    expect(found('tepla')).toEqual(['Горячая вода']);
    expect(found('teplá')).toEqual(['Горячая вода']);
  });

  test('a name of two words is found run together, and by punctuation', () => {
    expect(found('wifi')).toEqual(['Wi-Fi']);
    expect(found('wi fi')).toEqual(['Wi-Fi']);
    expect(found('вай-фай')).toEqual(['Wi-Fi']);
    expect(found('(бельё,')).toEqual(['Доставка (бельё, химия, кроватка и т. д.)']);
  });

  test('nothing found is an empty list', () => {
    expect(found('ёлка')).toEqual([]);
  });
});
