import * as shared from '@str-ops/shared/src/problems/categories';
import {
  CATALOG_FIXTURE,
  SEARCH_CASES,
  UNREADABLE_LEVEL_CATEGORY,
} from '@str-ops/shared/src/testing/problem-categories.fixture';

import * as phone from '../categories';
import type { ProblemCategory } from '../categories';

/**
 * The panel's «Новое задание» picks a category through the shared module
 * (`packages/shared/src/problems/categories.ts`, owner 2026-11-20); the phone
 * still through its own copy (`../categories`), until a build of it reads the
 * shared one. The two must give the same list in the same order and find the
 * same categories by the same letters: a manager and a cleaner pick from one
 * catalogue. This test holds them together; it ships in no bundle.
 */

// The client's 27, and one whose level could not be read: it must lead in both.
const CATALOG = [...CATALOG_FIXTURE, UNREADABLE_LEVEL_CATEGORY] as unknown as ProblemCategory[];
const ids = (list: readonly { id: string }[]) => list.map((category) => category.id);

describe('the phone and the panel pick a category by the same rules', () => {
  test('the same order of the list', () => {
    expect(ids(shared.inPickOrder(CATALOG))).toEqual(ids(phone.inPickOrder(CATALOG)));
    expect(shared.inPickOrder(CATALOG)[0].id).toBe(UNREADABLE_LEVEL_CATEGORY.id);
  });

  test.each(SEARCH_CASES)('the same answers to «$query» ($note)', ({ query }) => {
    const phoneIndex = phone.indexCategories(phone.inPickOrder(CATALOG));
    const sharedIndex = shared.indexCategories(shared.inPickOrder(CATALOG));

    expect(ids(shared.matchCategories(sharedIndex, query))).toEqual(
      ids(phone.matchCategories(phoneIndex, query)),
    );
  });

  test('the same level and the same name in each language', () => {
    for (const category of CATALOG) {
      expect(shared.categoryLevel(category)).toBe(phone.categoryLevel(category));
      for (const language of ['ru', 'en', 'cs', 'de']) {
        expect(shared.categoryName(category, language)).toBe(phone.categoryName(category, language));
      }
    }
  });
});
