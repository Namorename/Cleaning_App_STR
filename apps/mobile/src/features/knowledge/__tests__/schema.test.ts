import {
  articleExcerpt,
  articlesOfPlace,
  isKnowledgeBaseMissing,
  kbArticleListSchema,
  placeLabel,
  readArticleText,
  searchArticles,
  type KbArticle,
  type KbPlace,
} from '../schema';

function article(overrides: Partial<KbArticle> = {}): KbArticle {
  return {
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    scope: 'properties',
    language: 'ru',
    title: 'Котёл',
    body: 'Котёл в коридоре, **кнопка** справа.',
    updated_at: '2026-10-17T08:00:00Z',
    targets: [],
    translations: [],
    ...overrides,
  };
}

const FLAT: KbPlace = {
  id: 900066001,
  name: 'Flat one',
  parent_id: null,
  hostaway_unit_id: null,
  parent: null,
};
const HOUSE: KbPlace = {
  id: 900066010,
  name: 'The house',
  parent_id: null,
  hostaway_unit_id: null,
  parent: null,
};
const ROOM: KbPlace = {
  id: 1000000066011,
  name: 'Room one',
  parent_id: HOUSE.id,
  hostaway_unit_id: 66011,
  parent: { name: 'The house' },
};

const target = (propertyId: number, parentId: number | null = null) => ({
  property_id: propertyId,
  property: { parent_id: parentId },
});

describe('the text a reader sees', () => {
  const boiler = article({
    translations: [
      { language: 'en', title: 'Boiler', body: 'In the hall.' },
      { language: 'cs', title: 'Kotel', body: 'V chodbě.' },
    ],
  });

  test('the phone’s language when the article has it', () => {
    expect(readArticleText(boiler, 'cs')).toMatchObject({ title: 'Kotel', isOriginal: false });
  });

  test('the author’s own language when the phone’s is the original', () => {
    expect(readArticleText(boiler, 'ru')).toMatchObject({ title: 'Котёл', isOriginal: true });
  });

  test('the original, not English, when there is no translation in the phone’s language', () => {
    const onlyEnglish = article({
      translations: [{ language: 'en', title: 'Boiler', body: 'In the hall.' }],
    });

    expect(readArticleText(onlyEnglish, 'cs')).toMatchObject({
      language: 'ru',
      title: 'Котёл',
      isOriginal: true,
    });
  });
});

describe('the articles of a place', () => {
  const onFlat = article({ id: 'a1', title: 'Flat', targets: [target(FLAT.id)] });
  const onHouse = article({
    id: 'a2',
    title: 'House',
    scope: 'building',
    targets: [target(HOUSE.id)],
  });
  const onRoom = article({ id: 'a3', title: 'Room', targets: [target(ROOM.id, HOUSE.id)] });
  const company = article({ id: 'a4', title: 'Company', scope: 'company' });
  const all = [company, onRoom, onHouse, onFlat];

  test('a flat shows its own articles, not the whole company’s', () => {
    expect(articlesOfPlace(all, FLAT, 'ru').map((one) => one.id)).toEqual(['a1']);
  });

  test('a room shows its own and its house’s', () => {
    expect(articlesOfPlace(all, ROOM, 'ru').map((one) => one.id)).toEqual(['a2', 'a3']);
  });

  test('a house shows its own and its rooms’', () => {
    expect(articlesOfPlace(all, HOUSE, 'ru').map((one) => one.id)).toEqual(['a2', 'a3']);
  });

  test('a room whose house the reader cannot see still finds its own', () => {
    const hidden = article({
      id: 'a5',
      title: 'Hidden house',
      targets: [{ property_id: ROOM.id, property: null }],
    });

    expect(articlesOfPlace([hidden], ROOM, 'ru').map((one) => one.id)).toEqual(['a5']);
  });

  test('sorted by the title the reader sees', () => {
    const b = article({
      id: 'b',
      title: 'Б',
      targets: [target(FLAT.id)],
      translations: [{ language: 'en', title: 'A', body: 'x' }],
    });
    const a = article({ id: 'a', title: 'А', targets: [target(FLAT.id)] });

    expect(articlesOfPlace([a, b], FLAT, 'en').map((one) => one.id)).toEqual(['b', 'a']);
  });
});

describe('the search', () => {
  const boiler = article({
    id: 'boiler',
    title: 'Котёл',
    body: 'Кнопка справа.',
    translations: [{ language: 'cs', title: 'Kotel', body: 'Tlačítko vpravo.' }],
  });
  const bins = article({ id: 'bins', title: 'Мусор', body: 'Контейнеры во дворе.' });

  test('an empty query keeps every article', () => {
    expect(searchArticles([boiler, bins], '  ').map((one) => one.id)).toEqual(['boiler', 'bins']);
  });

  test('finds by title and by text, case and diacritics aside', () => {
    expect(searchArticles([boiler, bins], 'КОТЁЛ').map((one) => one.id)).toEqual(['boiler']);
    expect(searchArticles([boiler, bins], 'контейнеры').map((one) => one.id)).toEqual(['bins']);
    expect(searchArticles([boiler, bins], 'tlacitko').map((one) => one.id)).toEqual(['boiler']);
  });

  test('every word must be there, in any order', () => {
    expect(searchArticles([boiler, bins], 'справа кнопка').map((one) => one.id)).toEqual([
      'boiler',
    ]);
    expect(searchArticles([boiler, bins], 'кнопка двор')).toEqual([]);
  });
});

describe('a line to recognise an article by', () => {
  test('the text without its marks, on one line', () => {
    expect(articleExcerpt('> Не трогай **котёл**.\n\n1) Открой [кран](https://example.com).')).toBe(
      'Не трогай котёл. Открой кран.',
    );
  });

  test('cut short with an ellipsis', () => {
    const excerpt = articleExcerpt('слово '.repeat(60));

    expect(excerpt.length).toBeLessThanOrEqual(121);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('a place’s name', () => {
  test('a room with its house', () => {
    expect(placeLabel(ROOM)).toBe('The house — Room one');
  });

  test('anything else by its name', () => {
    expect(placeLabel(FLAT)).toBe('Flat one');
  });
});

describe('the rows as the server sends them', () => {
  test('an article this build cannot read is left out; the rest of the base stays', () => {
    const rows = kbArticleListSchema.parse([
      { ...article(), id: 'new-language', language: 'de' },
      { ...article(), id: 'new-scope', scope: 'group' },
      { ...article(), id: 'readable' },
    ]);

    expect(rows.map((row) => row.id)).toEqual(['readable']);
  });

  test('a list read once reads the same again, as the cache reads it on the way out', () => {
    const once = kbArticleListSchema.parse([article()]);

    expect(kbArticleListSchema.parse(once)).toEqual(once);
  });

  test('a translation in a language the apps do not speak is left out', () => {
    const [row] = kbArticleListSchema.parse([
      {
        ...article(),
        translations: [
          { language: 'de', title: 'Kessel', body: 'Im Flur.' },
          { language: 'en', title: 'Boiler', body: 'In the hall.' },
        ],
      },
    ]);

    expect(row.translations.map((one) => one.language)).toEqual(['en']);
  });
});

describe('a knowledge base the cloud does not have yet', () => {
  test.each([
    [{ code: 'PGRST205', message: 'Could not find the table' }, true],
    [{ code: '42P01', message: 'relation does not exist' }, true],
    [{ code: 'PGRST200', message: 'Could not find a relationship' }, true],
    [new TypeError('Network request failed'), false],
    [{ code: '42501', message: 'permission denied' }, false],
    [null, false],
  ])('%j is %s', (error, expected) => {
    expect(isKnowledgeBaseMissing(error)).toBe(expected);
  });
});
