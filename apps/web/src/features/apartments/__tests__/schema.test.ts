import { describe, expect, test } from 'vitest';

import {
  childrenOf,
  infoDraftFrom,
  isInTab,
  matchesTokens,
  needsChange,
  openCleaningsBy,
  openCleaningsOf,
  parentOf,
  possibleParents,
  propertyDetailSchema,
  propertySchema,
  type Property,
} from '../schema';

const base = {
  id: 571441,
  name: 'Vinohrady 12',
  address: 'Korunní 12',
  city: 'Praha',
  status: 'active',
  parent_id: null,
  bedrooms: 2,
  max_guests: 4,
};

const property = (overrides: Record<string, unknown> = {}): Property =>
  propertySchema.parse({ ...base, ...overrides });

describe('propertySchema', () => {
  test('a state a later migration adds does not blank the list', () => {
    // It falls back to the reading that shows the row: a listing nobody can
    // see is a listing nobody can fix.
    expect(property({ status: 'renovating' }).status).toBe('active');
  });
});

describe('matchesTokens', () => {
  test('every word has to be found, in any order', () => {
    expect(matchesTokens(property(), 'vinohrady 12')).toBe(true);
    expect(matchesTokens(property(), '12 vinohrady')).toBe(true);
  });

  test('a word that is nowhere fails the whole search', () => {
    expect(matchesTokens(property(), 'vinohrady karlin')).toBe(false);
  });

  test('the address, the city and the listing number are searched too', () => {
    expect(matchesTokens(property(), 'korunní')).toBe(true);
    expect(matchesTokens(property(), 'praha')).toBe(true);
    expect(matchesTokens(property(), '571441')).toBe(true);
  });

  test('an empty search keeps everybody', () => {
    expect(matchesTokens(property(), '   ')).toBe(true);
  });

  test('a listing with no address is searched by what it does have', () => {
    const bare = property({ address: null, city: null });

    expect(matchesTokens(bare, 'vinohrady')).toBe(true);
    expect(matchesTokens(bare, 'praha')).toBe(false);
  });
});

describe('isInTab', () => {
  test('a tab is a state, and the archive is its own', () => {
    expect(isInTab(property(), 'active')).toBe(true);
    expect(isInTab(property({ status: 'archived' }), 'active')).toBe(false);
    expect(isInTab(property({ status: 'archived' }), 'archived')).toBe(true);
    expect(isInTab(property({ status: 'maintenance' }), 'maintenance')).toBe(true);
  });
});

describe('listings that belong together', () => {
  const parent = property({ id: 571441, name: 'Whole flat' });
  const unitA = property({ id: 566761, name: 'Room A', parent_id: 571441 });
  const unitB = property({ id: 566769, name: 'Room B', parent_id: 571441 });
  const all = [parent, unitA, unitB];

  test('a combined listing names its units', () => {
    expect(childrenOf(all, 571441).map((one) => one.name)).toEqual(['Room A', 'Room B']);
  });

  test('a unit names the listing it belongs to', () => {
    expect(parentOf(all, unitA)?.name).toBe('Whole flat');
  });

  test('a listing on its own has neither', () => {
    expect(parentOf(all, parent)).toBeNull();
    expect(childrenOf(all, 566761)).toEqual([]);
  });

  test('a parent that is not in the list does not throw', () => {
    expect(parentOf([unitA], unitA)).toBeNull();
  });
});

describe('cleanings at stake', () => {
  const rows = [{ property_id: 1 }, { property_id: 1 }, { property_id: 2 }];

  test('counted per listing', () => {
    const counts = openCleaningsBy(rows);

    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.get(3)).toBeUndefined();
  });

  test('and added up for a bulk action', () => {
    const counts = openCleaningsBy(rows);

    expect(openCleaningsOf(counts, [1, 2])).toBe(3);
    // A listing with nothing booked adds nothing rather than breaking the sum.
    expect(openCleaningsOf(counts, [1, 3])).toBe(2);
    expect(openCleaningsOf(counts, [])).toBe(0);
  });
});

describe('needsChange', () => {
  const all = [
    property({ id: 1, status: 'active' }),
    property({ id: 2, status: 'archived' }),
    property({ id: 3, status: 'active' }),
  ];

  test('a listing already in that state is not asked about', () => {
    expect(needsChange(all, [1, 2, 3], 'archived')).toEqual([1, 3]);
  });

  test('and when nothing would change, nothing is', () => {
    expect(needsChange(all, [2], 'archived')).toEqual([]);
  });
});

describe('possibleParents', () => {
  const whole = property({ id: 1, name: 'Whole flat' });
  const unit = property({ id: 2, name: 'Room A', parent_id: 1 });
  const other = property({ id: 3, name: 'Anděl 4' });
  const gone = property({ id: 4, name: 'Karlín 7', status: 'archived' });
  const all = [whole, unit, other, gone];

  test('a listing is not its own parent', () => {
    expect(possibleParents(all, whole).map((one) => one.id)).not.toContain(1);
  });

  test('and neither is one of its own units — that would be a loop', () => {
    expect(possibleParents(all, whole).map((one) => one.id)).not.toContain(2);
  });

  test("an archived listing is nobody's parent", () => {
    expect(possibleParents(all, whole).map((one) => one.id)).not.toContain(4);
  });

  test('what is left is offered', () => {
    expect(possibleParents(all, whole).map((one) => one.id)).toEqual([3]);
  });
});

describe('infoDraftFrom', () => {
  test('turns the nulls of a row into the empty strings a form can hold', () => {
    const draft = infoDraftFrom(
      propertyDetailSchema.parse({
        ...base,
        country_code: null,
        timezone: 'UTC',
        bathrooms: null,
        check_in_time: null,
        check_out_time: null,
        cleaner_notes: null,
        internal_notes: null,
        synced_at: null,
      }),
    );

    expect(draft).toEqual({ parentId: null, cleanerNotes: '', internalNotes: '' });
  });
});
