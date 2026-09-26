import { describe, expect, test } from 'vitest';

import {
  checklistSources,
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
  registryRows,
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

  test('a name and an address typed without diacritics are found', () => {
    const czech = property({ name: 'CZ - Vinohradská Royal', address: 'Korunní 12' });

    expect(matchesTokens(czech, 'vinohradska')).toBe(true);
    expect(matchesTokens(czech, 'korunni 12')).toBe(true);
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
  // The server has already folded each room's cleanings into its listing, so a
  // listing arrives as one row carrying its total — not as one row per task.
  const rows = [
    { property_id: 1, cleanings: 2 },
    { property_id: 2, cleanings: 1 },
  ];

  test('counted per listing', () => {
    const counts = openCleaningsBy(rows);

    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.get(3)).toBeUndefined();
  });

  test('a listing the server did not mention has no cleanings, not a crash', () => {
    const counts = openCleaningsBy([]);

    expect(counts.get(1)).toBeUndefined();
    expect(openCleaningsOf(counts, [1, 2])).toBe(0);
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

/**
 * The same question `guard_property_hierarchy` asks, asked before the server
 * has to refuse: the tree is two levels, a parent is a row with no parent of
 * its own, and a row that already has units cannot become one.
 */
describe('possibleParents', () => {
  const whole = property({ id: 1, name: 'Whole flat' });
  const part = property({ id: 2, name: 'Room A', parent_id: 1 });
  const other = property({ id: 3, name: 'Anděl 4' });
  const gone = property({ id: 4, name: 'Karlín 7', status: 'archived' });
  const room = property({ id: 5, name: 'Unit 1', parent_id: 6, hostaway_unit_id: 9001 });
  const house = property({ id: 6, name: 'Royal Cerna' });
  const alone = property({ id: 7, name: 'Karlín 9' });
  const all = [whole, part, other, gone, room, house, alone];

  const ids = (of: Property) => possibleParents(all, of).map((one) => one.id);

  test('a listing is not its own parent', () => {
    expect(ids(alone)).not.toContain(7);
  });

  test("an archived listing is nobody's parent", () => {
    expect(ids(alone)).not.toContain(4);
  });

  test('a part or a room is nobody’s parent — the tree is two levels', () => {
    expect(ids(alone)).not.toContain(2);
    expect(ids(alone)).not.toContain(5);
  });

  test('what is left is offered, a listing with units of its own included', () => {
    expect(ids(alone)).toEqual([1, 3, 6]);
  });

  test('a listing that has units is offered no parent at all', () => {
    expect(ids(whole)).toEqual([]);
    expect(ids(house)).toEqual([]);
  });

  test('a room is offered none either — Hostaway names its listing', () => {
    expect(ids(room)).toEqual([]);
  });

  test('a part keeps the listing it is in among the choices', () => {
    expect(ids(part)).toEqual([1, 3, 6, 7]);
  });
});

describe('checklistSources', () => {
  const all = [
    property({ id: 1, name: 'Whole flat' }),
    property({ id: 2, name: 'Villa part', parent_id: 1 }),
    property({ id: 3, name: 'Unit 1', parent_id: 6, hostaway_unit_id: 9001 }),
    property({ id: 4, name: 'Karlín 7', status: 'archived' }),
    property({ id: 6, name: 'Royal Cerna' }),
  ];

  // A room has no checklist of its own in the cloud, and copying from one would
  // hand out a list the server resolves from its listing anyway (trap 1).
  test('offers listings and parts, never a room, the archive or itself', () => {
    expect(checklistSources(all, 6).map((one) => one.id)).toEqual([1, 2]);
  });
});

describe('registryRows', () => {
  const house = property({ id: 10, name: 'Royal Cerna' });
  const unit3 = property({ id: 11, name: 'Unit 3', parent_id: 10, hostaway_unit_id: 7003 });
  const unit4 = property({ id: 12, name: 'Unit 4', parent_id: 10, hostaway_unit_id: 7004 });
  const fixing = property({
    id: 13,
    name: 'Unit 5',
    parent_id: 10,
    hostaway_unit_id: 7005,
    status: 'maintenance',
  });
  const plain = property({ id: 20, name: 'Anglicka 7', address: 'Anglická 7' });
  const all = [house, unit3, unit4, fixing, plain];

  const names = (tab: 'active' | 'maintenance', query: string) =>
    registryRows(all, tab, query).map((one) => one.name);

  test('with no search the tab shows its rows, rooms included', () => {
    expect(names('active', '')).toEqual(['Royal Cerna', 'Unit 3', 'Unit 4', 'Anglicka 7']);
  });

  test('a room found by name is shown under its listing', () => {
    expect(names('active', 'unit 3')).toEqual(['Royal Cerna', 'Unit 3']);
  });

  test('a listing found by name keeps its rooms', () => {
    expect(names('active', 'royal')).toEqual(['Royal Cerna', 'Unit 3', 'Unit 4']);
  });

  // Trap 3: a room stands in the tab of its own status.
  test('a room in another state than its listing is in its own tab, alone', () => {
    expect(names('maintenance', '')).toEqual(['Unit 5']);
    expect(names('active', '')).not.toContain('Unit 5');
  });
});

describe('infoDraftFrom', () => {
  const detail = (overrides: Record<string, unknown> = {}) =>
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
      ...overrides,
    });

  test('turns the nulls of a row into the empty strings a form can hold', () => {
    expect(infoDraftFrom(detail())).toEqual({
      parentId: null,
      hasParentChoice: true,
      cleanerNotes: '',
      internalNotes: '',
    });
  });

  // The sync writes a room's listing; a save that sent it back would undo a
  // Hostaway change or, empty, fail on properties_unit_has_parent (trap 5).
  test('a room has no parent to choose', () => {
    const draft = infoDraftFrom(detail({ parent_id: 10, hostaway_unit_id: 7003 }));

    expect(draft.hasParentChoice).toBe(false);
  });
});
