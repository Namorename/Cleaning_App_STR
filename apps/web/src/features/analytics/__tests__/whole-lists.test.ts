import { describe, expect, test } from 'vitest';

import { NO_FILTERS } from '../schema';
import { offeredListingIds, wholeAsAll, wholeListsAsAll, type FilterChoices } from '../whole-lists';

// Ten listings, the tenth archived; ten people: lists long enough for «Выбрать всё».
const LIVE = Array.from({ length: 9 }, (_, index) => index + 1);
const ARCHIVED = 10;
const PEOPLE = Array.from({ length: 10 }, (_, index) => `0000000${index}-1111-4111-8111-111111111111`);

const CHOICES: FilterChoices = {
  listings: [
    ...LIVE.map((id) => ({ id, isArchived: false })),
    { id: ARCHIVED, isArchived: true },
  ],
  personIds: PEOPLE,
};

describe('wholeAsAll', () => {
  test('a long list with every value offered is "all"; a part of it stays as it is', () => {
    expect(wholeAsAll([...LIVE].reverse(), LIVE)).toEqual([]);
    expect(wholeAsAll([...LIVE, 99], LIVE)).toEqual([]);
    const part = LIVE.slice(1);
    expect(wholeAsAll(part, LIVE)).toBe(part);
  });

  test('a short list keeps what it always meant, and so does a list not loaded yet', () => {
    const short = [1, 2];
    expect(wholeAsAll(short, [1, 2])).toBe(short);
    expect(wholeAsAll(short, [])).toBe(short);
  });
});

describe('wholeListsAsAll', () => {
  test('the live listings ticked whole are "all" only when the switch hides the archived', () => {
    const live = { ...NO_FILTERS, propertyIds: LIVE };
    expect(wholeListsAsAll(live, CHOICES).propertyIds).toEqual(LIVE);
    expect(wholeListsAsAll({ ...live, hideArchived: true }, CHOICES).propertyIds).toEqual([]);
    expect(wholeListsAsAll({ ...live, propertyIds: [...LIVE, ARCHIVED] }, CHOICES).propertyIds).toEqual([]);
  });

  test('everybody ticked is "all"; the statuses are left as they are', () => {
    const filters = { ...NO_FILTERS, personIds: [...PEOPLE].reverse(), taskStatuses: ['done' as const] };
    expect(wholeListsAsAll(filters, CHOICES)).toEqual({ ...filters, personIds: [] });
  });

  test('filters with nothing whole come back as the same object', () => {
    const filters = { ...NO_FILTERS, propertyIds: [1], personIds: [PEOPLE[0]] };
    expect(wholeListsAsAll(filters, CHOICES)).toBe(filters);
  });

  test('the archived switch decides which listings are offered', () => {
    expect(offeredListingIds(CHOICES, false)).toEqual([...LIVE, ARCHIVED]);
    expect(offeredListingIds(CHOICES, true)).toEqual(LIVE);
  });
});
