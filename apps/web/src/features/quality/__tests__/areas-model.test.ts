import { describe, expect, test } from 'vitest';

import { areasOf } from '../areas-model';
import type { QualityAreaMember, QualityAreas } from '../schema';
import { portfolioLinesOf } from '../view-model';
import {
  FOURTEEN_DAYS,
  META,
  overviewOfRows,
  placeOf,
  READ_HISTORY,
  SIX_MONTHS,
  themeOf,
} from './fixtures';

function memberOf(over: Partial<QualityAreaMember> = {}): QualityAreaMember {
  return {
    theme: 'wifi',
    property_id: 1,
    name: 'Old Town flat',
    basis: 'guest',
    episodes: 3,
    stays: 40,
    ...over,
  };
}

function areasWith(members: readonly QualityAreaMember[]): QualityAreas {
  return { window: '12m', computed_on: '2026-11-05', members: [...members] };
}

const OVERVIEW = overviewOfRows([placeOf()], []);

describe('areasOf: the rows', () => {
  test('puts the widest area first, a tie in the order of the list', () => {
    const { rows } = areasOf(
      areasWith([
        memberOf({ theme: 'parking', property_id: 1 }),
        memberOf({ theme: 'wifi', property_id: 2 }),
        memberOf({ theme: 'heating', property_id: 3 }),
        memberOf({ theme: 'parking', property_id: 4 }),
      ]),
      OVERVIEW,
    );

    expect(rows.map((row) => row.theme)).toEqual(['parking', 'heating', 'wifi']);
  });

  test('counts a place once, however many sides say so', () => {
    const { rows } = areasOf(
      areasWith([
        memberOf({ theme: 'wifi', property_id: 1, basis: 'guest' }),
        memberOf({ theme: 'wifi', property_id: 1, basis: 'staff' }),
        memberOf({ theme: 'heating', property_id: 2 }),
        memberOf({ theme: 'heating', property_id: 3 }),
      ]),
      OVERVIEW,
    );

    expect(rows.map((row) => [row.theme, row.places.length])).toEqual([
      ['heating', 2],
      ['wifi', 1],
    ]);
  });

  test('lets a place stand in many areas', () => {
    const { rows } = areasOf(
      areasWith([memberOf({ theme: 'wifi' }), memberOf({ theme: 'heating' })]),
      OVERVIEW,
    );

    expect(rows.flatMap((row) => row.places.map((place) => place.id))).toEqual([1, 1]);
  });

  test('keeps the two sides of a place apart, guests first, and adds nothing up', () => {
    const { rows } = areasOf(
      areasWith([
        memberOf({ basis: 'staff', episodes: 2, stays: 40 }),
        memberOf({ basis: 'guest', episodes: 3, stays: 40 }),
      ]),
      OVERVIEW,
    );

    expect(rows[0].places).toEqual([
      {
        id: 1,
        name: 'Old Town flat',
        lines: [
          { basis: 'guest', episodes: 3, stays: 40 },
          { basis: 'staff', episodes: 2, stays: 40 },
        ],
      },
    ]);
  });

  test('keeps the server’s order of the places of an area', () => {
    const { rows } = areasOf(
      areasWith([
        memberOf({ property_id: 9, name: 'Busy flat', episodes: 8 }),
        memberOf({ property_id: 2, name: 'Quiet flat', episodes: 2 }),
      ]),
      OVERVIEW,
    );

    expect(rows[0].places.map((place) => place.name)).toEqual(['Busy flat', 'Quiet flat']);
  });
});

describe('areasOf: the dynamics', () => {
  test('are the overview’s line of the theme, for every place and not only the members', () => {
    const overview = overviewOfRows(
      [placeOf({ id: 1 }), placeOf({ id: 2 })],
      [
        themeOf({ property_id: 1, reviews: 2, reviews_prev: 10 }),
        themeOf({ property_id: 2, reviews: 30, reviews_prev: 4 }),
      ],
      SIX_MONTHS,
    );

    const { rows } = areasOf(areasWith([memberOf({ property_id: 1 })]), overview);

    expect(rows[0].line).toEqual(portfolioLinesOf(overview)[0]);
    expect(rows[0].line?.trend).toBe('rising');
  });

  test('reach a theme the overview’s block does not lift', () => {
    const codes = ['heating', 'wifi', 'tv', 'kettle', 'parking', 'smell'] as const;
    const overview = overviewOfRows(
      [placeOf()],
      codes.map((theme, at) => themeOf({ theme, reviews: 10 - at })),
    );

    const { rows } = areasOf(areasWith([memberOf({ theme: 'smell' })]), overview);

    expect(rows[0].line?.theme).toBe('smell');
  });

  test('carry the overview’s reason for saying nothing', () => {
    const overview = overviewOfRows(
      [placeOf()],
      [themeOf({ reviews: 20, reviews_prev: 5 })],
      FOURTEEN_DAYS,
    );

    const { rows } = areasOf(areasWith([memberOf()]), overview);

    expect(rows[0].line?.trend).toBe('reviews_settling');
  });

  test('are none when the theme left the overview since the night', () => {
    const { rows } = areasOf(areasWith([memberOf()]), OVERVIEW);

    expect(rows[0].line).toBeNull();
  });
});

describe('areasOf: what it has not got', () => {
  test('the night has not come yet, whatever else is missing', () => {
    const overview = overviewOfRows([placeOf()], [], {
      ...META,
      history: { ...READ_HISTORY, stays_from: null },
    });

    const model = areasOf({ window: '12m', computed_on: null, members: [] }, overview);

    expect(model.empty).toBe('not_computed');
    expect(model.computedOn).toBeNull();
  });

  test.each([
    ['never read', null],
    ['read from inside the window', '2026-06-01'],
  ])('stays %s: nothing to count on, and no member stands on a part of them', (_case, from) => {
    const overview = overviewOfRows([placeOf()], [], {
      ...META,
      history: { ...READ_HISTORY, stays_from: from },
    });

    const model = areasOf(areasWith([memberOf()]), overview);

    expect(model.empty).toBe('stays_unknown');
    expect(model.rows).toEqual([]);
  });

  test('a short window goes by the bookings held', () => {
    const overview = overviewOfRows([placeOf()], [], { ...FOURTEEN_DAYS, held_from: null });

    expect(areasOf(areasWith([]), overview).empty).toBe('stays_unknown');
  });

  test('counted and empty: no theme stands out, on these stays', () => {
    const overview = overviewOfRows(
      [placeOf({ id: 1, stays: 70 }), placeOf({ id: 2, stays: 6 })],
      [],
    );

    const model = areasOf(areasWith([]), overview);

    expect(model.empty).toBe('none');
    expect(model.stays).toBe(76);
  });

  test('has members: nothing to explain', () => {
    expect(areasOf(areasWith([memberOf()]), OVERVIEW).empty).toBeNull();
  });
});
