import { describe, expect, test } from 'vitest';

import {
  canHaveLinks,
  countLinks,
  draftFrom,
  EMPTY_DRAFT,
  isInTab,
  linksOf,
  matchesRole,
  matchesSearch,
  staffSchema,
  unlinkedProperties,
  type CleanerLink,
  type Property,
  type Staff,
} from '../schema';

const MARIA = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const PETR = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';

const base = {
  id: MARIA,
  full_name: 'Maria Test',
  email: 'maria@example.com',
  phone: '+420 777 111 222',
  role: 'cleaner',
  preferred_language: 'cs',
  is_active: true,
  created_at: '2026-09-01T08:00:00+00:00',
};

const staff = (overrides: Record<string, unknown> = {}): Staff =>
  staffSchema.parse({ ...base, ...overrides });

const link = (propertyId: number, overrides: Partial<CleanerLink> = {}): CleanerLink => ({
  property_id: propertyId,
  cleaner_id: MARIA,
  mode: 'claim',
  priority: 1,
  ...overrides,
});

const properties: Property[] = [
  { id: 1, name: 'Vinohrady 12' },
  { id: 2, name: 'Anděl 4' },
  { id: 3, name: 'Karlín 7' },
];

describe('staffSchema', () => {
  test('keeps a row whose role a later migration added, rather than blanking the list', () => {
    const parsed = staff({ role: 'inspector' });

    expect(parsed.role).toBe('cleaner');
  });

  test('treats a language the panel does not speak as no choice at all', () => {
    const parsed = staff({ preferred_language: 'de' });

    expect(parsed.preferred_language).toBeNull();
  });
});

describe('draftFrom', () => {
  test('starts a new person from the empty draft', () => {
    expect(draftFrom(null)).toEqual(EMPTY_DRAFT);
  });

  test('turns the nulls of a row into the empty strings a form can hold', () => {
    const draft = draftFrom(staff({ full_name: null, phone: null, preferred_language: null }));

    expect(draft).toEqual({
      id: MARIA,
      fullName: '',
      email: 'maria@example.com',
      phone: '',
      role: 'cleaner',
      language: '',
      isActive: true,
    });
  });
});

describe('isInTab', () => {
  test('puts somebody working under "working" and somebody switched off under "off"', () => {
    expect(isInTab(staff(), 'working')).toBe(true);
    expect(isInTab(staff(), 'off')).toBe(false);
    expect(isInTab(staff({ is_active: false }), 'off')).toBe(true);
    expect(isInTab(staff({ is_active: false }), 'working')).toBe(false);
  });

  test('shows everybody under "all", working or not', () => {
    expect(isInTab(staff(), 'all')).toBe(true);
    expect(isInTab(staff({ is_active: false }), 'all')).toBe(true);
  });
});

describe('matchesSearch', () => {
  test('matches the name, the login or the phone, whichever the manager has to hand', () => {
    expect(matchesSearch(staff(), 'maria')).toBe(true);
    expect(matchesSearch(staff(), 'example.com')).toBe(true);
    expect(matchesSearch(staff(), '777')).toBe(true);
  });

  test('ignores case and surrounding spaces', () => {
    expect(matchesSearch(staff(), '  MARIA  ')).toBe(true);
  });

  test('lets everybody through on an empty query', () => {
    expect(matchesSearch(staff(), '   ')).toBe(true);
  });

  test('does not crash on a row with nothing filled in', () => {
    const blank = staff({ full_name: null, email: null, phone: null });

    expect(matchesSearch(blank, 'maria')).toBe(false);
    expect(matchesSearch(blank, '')).toBe(true);
  });
});

describe('matchesRole', () => {
  test('an empty filter is every role', () => {
    expect(matchesRole(staff(), '')).toBe(true);
  });

  test('otherwise the role has to be the one asked for', () => {
    expect(matchesRole(staff(), 'cleaner')).toBe(true);
    expect(matchesRole(staff(), 'tech')).toBe(false);
  });
});

describe('canHaveLinks', () => {
  test('offers listings to the people who do the work there', () => {
    expect(canHaveLinks(staff({ role: 'cleaner' }))).toBe(true);
    expect(canHaveLinks(staff({ role: 'tech' }))).toBe(true);
  });

  test('keeps a manager out of the queue, so she does not turn up in a schedule', () => {
    expect(canHaveLinks(staff({ role: 'manager' }))).toBe(false);
    expect(canHaveLinks(staff({ role: 'admin' }))).toBe(false);
  });
});

describe('countLinks', () => {
  test('counts only this person, out of everybody in the company', () => {
    const links = [link(1), link(2), link(3, { cleaner_id: PETR })];

    expect(countLinks(links, MARIA)).toBe(2);
    expect(countLinks(links, PETR)).toBe(1);
  });
});

describe('linksOf', () => {
  test('puts what is handed over automatically before what waits in a queue', () => {
    const links = [link(1), link(2, { mode: 'auto' })];

    expect(linksOf(links, properties, MARIA).map((row) => row.name)).toEqual([
      'Anděl 4',
      'Vinohrady 12',
    ]);
  });

  test('orders a queue by position, and breaks a tie by name so it does not shuffle', () => {
    const links = [
      link(1, { priority: 2 }),
      link(2, { priority: 1 }),
      link(3, { priority: 1 }),
    ];

    expect(linksOf(links, properties, MARIA).map((row) => row.name)).toEqual([
      'Anděl 4',
      'Karlín 7',
      'Vinohrady 12',
    ]);
  });

  test('leaves out everybody else', () => {
    const links = [link(1), link(2, { cleaner_id: PETR })];

    expect(linksOf(links, properties, MARIA)).toHaveLength(1);
  });

  test('falls back to the number when the listing is not in the list', () => {
    expect(linksOf([link(99)], properties, MARIA)[0].name).toBe('99');
  });
});

describe('unlinkedProperties', () => {
  test('does not offer a listing she already works', () => {
    const left = unlinkedProperties([link(1), link(3)], properties, MARIA);

    expect(left.map((property) => property.name)).toEqual(['Anděl 4']);
  });

  test('somebody else holding a listing does not take it off her list', () => {
    const left = unlinkedProperties([link(1, { cleaner_id: PETR })], properties, MARIA);

    expect(left).toHaveLength(3);
  });
});
