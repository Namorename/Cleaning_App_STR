import { describe, expect, test } from 'vitest';

import { readKnowledgeAddress, writeKnowledgeAddress } from '../address';
import { applyMark } from '../markup-edit';
import { articleTouchesPlace, buildingsOf, placeIndex, placeLabel } from '../places';
import {
  draftOf,
  emptyDraft,
  isSameDraft,
  translationsPayload,
  withLanguage,
  type Article,
  type Place,
} from '../schema';

const ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

describe('the address of «База знаний»', () => {
  const read = (query: string) => readKnowledgeAddress(new URLSearchParams(query));

  test('a bare address: drafts and published, every place, no article open', () => {
    expect(read('')).toEqual({ status: 'current', place: null, article: null });
    expect(writeKnowledgeAddress(read(''))).toBe('');
  });

  test('keeps the status, the place and the article open, and writes them back', () => {
    const address = read(`status=archived&place=900066001&article=${ID}`);

    expect(address).toEqual({ status: 'archived', place: 900066001, article: ID });
    expect(writeKnowledgeAddress(address)).toBe(`status=archived&place=900066001&article=${ID}`);
  });

  test('the whole company and a new article have names of their own', () => {
    expect(read('place=company&article=new')).toEqual({
      status: 'current',
      place: 'company',
      article: 'new',
    });
  });

  test('a part that makes no sense is dropped, the rest kept', () => {
    expect(read('status=deleted&place=flat&article=../../x')).toEqual({
      status: 'current',
      place: null,
      article: null,
    });
    expect(read(`status=draft&place=-4&article=${ID.toUpperCase()}`)).toEqual({
      status: 'draft',
      place: null,
      article: ID,
    });
  });
});

const article: Article = {
  id: ID,
  status: 'published',
  scope: 'properties',
  language: 'ru',
  title: 'Котёл',
  body: 'В коридоре.',
  rev: 4,
  updated_at: '2026-10-17T08:00:00Z',
  targets: [{ property_id: 2 }, { property_id: 1 }],
  translations: [{ language: 'en', title: 'Boiler', body: 'In the hall.' }],
};

describe('the draft an editor holds', () => {
  test('starts from the article, places in order', () => {
    expect(draftOf(article)).toEqual({
      id: ID,
      language: 'ru',
      title: 'Котёл',
      body: 'В коридоре.',
      translations: { en: { title: 'Boiler', body: 'In the hall.' } },
      scope: 'properties',
      propertyIds: [1, 2],
    });
  });

  test('a new one is a company article in the writer’s language', () => {
    expect(emptyDraft(ID, 'cs')).toEqual({
      id: ID,
      language: 'cs',
      title: '',
      body: '',
      translations: {},
      scope: 'company',
      propertyIds: [],
    });
  });

  test('two drafts with the same content are the same, an empty translation or not', () => {
    const draft = draftOf(article);

    expect(isSameDraft(draft, { ...draft, translations: { ...draft.translations, cs: { title: '', body: '' } } })).toBe(true);
    expect(isSameDraft(draft, { ...draft, body: 'В подвале.' })).toBe(false);
    expect(isSameDraft(draft, { ...draft, propertyIds: [2, 1] })).toBe(true);
    expect(isSameDraft(draft, { ...draft, propertyIds: [1] })).toBe(false);
  });

  test('sends the translations with a title, trimmed; never one in the original’s language', () => {
    const draft = {
      ...draftOf(article),
      translations: {
        en: { title: '  Boiler ', body: 'In the hall.' },
        cs: { title: '', body: '' },
        ru: { title: 'lost', body: 'lost' },
      },
    };

    expect(translationsPayload(draft)).toEqual({ en: { title: 'Boiler', body: 'In the hall.' } });
  });

  test('a text without a title is still sent, for the server to refuse by name', () => {
    const draft = { ...draftOf(article), translations: { cs: { title: ' ', body: 'Kotel.' } } };

    expect(translationsPayload(draft)).toEqual({ cs: { title: '', body: 'Kotel.' } });
  });

  test('changing the original’s language to one that has a translation swaps the two', () => {
    const swapped = withLanguage(draftOf(article), 'en');

    expect(swapped.language).toBe('en');
    expect([swapped.title, swapped.body]).toEqual(['Boiler', 'In the hall.']);
    expect(swapped.translations).toEqual({ ru: { title: 'Котёл', body: 'В коридоре.' } });
  });

  test('to one without a translation only renames it', () => {
    const renamed = withLanguage(draftOf(article), 'cs');

    expect([renamed.language, renamed.title]).toEqual(['cs', 'Котёл']);
    expect(renamed.translations).toEqual({ en: { title: 'Boiler', body: 'In the hall.' } });
  });
});

const places: Place[] = [
  { id: 1, name: 'Flat one', parent_id: null, hostaway_unit_id: null, status: 'active' },
  { id: 10, name: 'The house', parent_id: null, hostaway_unit_id: null, status: 'active' },
  { id: 11, name: 'Room one', parent_id: 10, hostaway_unit_id: 66011, status: 'active' },
  { id: 12, name: 'Room two', parent_id: 10, hostaway_unit_id: 66012, status: 'active' },
  { id: 20, name: 'Villa', parent_id: null, hostaway_unit_id: null, status: 'archived' },
  { id: 21, name: 'Villa east', parent_id: 20, hostaway_unit_id: null, status: 'archived' },
];

describe('places', () => {
  const index = placeIndex(places);

  test('a room is named with its house, a part of a villa by its own name', () => {
    expect(placeLabel(index, 11)).toBe('The house — Room one');
    expect(placeLabel(index, 21)).toBe('Villa east');
    expect(placeLabel(index, 1)).toBe('Flat one');
    expect(placeLabel(index, 999)).toBeNull();
  });

  test('a building is a listing with rooms or parts under it', () => {
    expect(buildingsOf(places).map((place) => place.id)).toEqual([10, 20]);
  });

  test('an article on a house is about each of its rooms; one on a room is about the house', () => {
    expect(articleTouchesPlace([10], 11, index)).toBe(true);
    expect(articleTouchesPlace([11], 10, index)).toBe(true);
    expect(articleTouchesPlace([11], 12, index)).toBe(false);
    expect(articleTouchesPlace([1], 1, index)).toBe(true);
    expect(articleTouchesPlace([1], 10, index)).toBe(false);
  });
});

describe('the buttons of the text', () => {
  test('bold wraps the selection, or puts the marks around the caret', () => {
    expect(applyMark('Press it hard', 9, 13, 'bold', 'link text')).toEqual({
      text: 'Press it **hard**',
      start: 11,
      end: 15,
    });
    expect(applyMark('Press ', 6, 6, 'bold', 'link text')).toEqual({
      text: 'Press ****',
      start: 8,
      end: 8,
    });
  });

  test('a list mark goes at the start of each line the selection touches', () => {
    expect(applyMark('towels\nsheets\nsoap', 2, 9, 'bullet', 'link text')).toEqual({
      text: '- towels\n- sheets\nsoap',
      start: 4,
      end: 13,
    });
  });

  test('numbered items and steps are numbered from one', () => {
    expect(applyMark('open\nturn', 0, 9, 'numbered', '').text).toBe('1. open\n2. turn');
    expect(applyMark('open\nturn', 0, 9, 'step', '').text).toBe('1) open\n2) turn');
  });

  test('a line that already carries the mark keeps one', () => {
    expect(applyMark('> Careful', 3, 3, 'important', '').text).toBe('> Careful');
  });

  test('a link takes the selection as its text, or a placeholder', () => {
    expect(applyMark('See the manual', 4, 14, 'link', 'link text')).toEqual({
      text: 'See [the manual](https://)',
      start: 25,
      end: 25,
    });
    expect(applyMark('', 0, 0, 'link', 'link text').text).toBe('[link text](https://)');
  });
});
