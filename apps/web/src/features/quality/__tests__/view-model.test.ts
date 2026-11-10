import { describe, expect, test } from 'vitest';

import { readingOf } from '../theme-model';
import { monthBarsOf, overviewOf, placeCardOf, type OverviewFilters } from '../view-model';
import {
  byCity,
  cardOf,
  FOURTEEN_DAYS,
  NOT_READ,
  META,
  overviewOfRows,
  placeOf,
  READ_HISTORY,
  SIX_MONTHS,
  themeOf,
} from './fixtures';

const ALL: OverviewFilters = { city: null, onlyNew: false };

/** Five flats of one city, 100 stays in each window. */
const FIVE_FLATS = [1, 2, 3, 4, 5].map((id) => placeOf({ id, name: `Flat ${id}` }));

describe('readingOf', () => {
  test('a reading never started is unread', () => {
    expect(
      readingOf({ ...READ_HISTORY, enabled: false, weeks_done: 0, weeks_total: null }),
    ).toEqual({
      kind: 'unread',
    });
  });

  test('a reading under way says how far it is, with or without a total', () => {
    expect(readingOf({ ...READ_HISTORY, weeks_done: 14, weeks_total: 49 })).toEqual({
      kind: 'reading',
      done: 14,
      total: 49,
    });
    expect(readingOf({ ...READ_HISTORY, weeks_done: 0, weeks_total: null })).toEqual({
      kind: 'reading',
      done: 0,
      total: null,
    });
  });

  test('a reading switched off half way is not over', () => {
    expect(
      readingOf({ ...READ_HISTORY, enabled: false, weeks_done: 14, weeks_total: 49 }).kind,
    ).toBe('reading');
  });

  test('a reading over stays over once it is switched off', () => {
    expect(readingOf({ ...READ_HISTORY, enabled: false }).kind).toBe('done');
  });
});

describe('overviewOf: from places up to the portfolio', () => {
  test('sums the layers of a theme across places, each layer on its own', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ id: 1 }), placeOf({ id: 2 })],
        [
          themeOf({ property_id: 1, reviews: 2, found: 1 }),
          themeOf({ property_id: 2, reviews: 1, reported: 3 }),
        ],
      ),
      ALL,
    );

    expect(view.portfolio.places).toBe(2);
    expect(view.portfolio.stays).toBe(200);
    expect(view.portfolio.themes).toHaveLength(1);
    expect(view.portfolio.themes[0].layers).toEqual({ reviews: 3, found: 1, reported: 3 });
  });

  test('chats stand apart: counted as chats, never in the reviews, and a theme said only in chats still shows', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ id: 1 }), placeOf({ id: 2 })],
        [
          themeOf({ property_id: 1, theme: 'wifi', reviews: 2, messages: 1 }),
          themeOf({ property_id: 2, theme: 'hot_water', messages: 3 }),
        ],
        { ...META, messages_on: true },
      ),
      ALL,
    );

    const wifi = view.portfolio.themes.find((line) => line.theme === 'wifi');
    const water = view.portfolio.themes.find((line) => line.theme === 'hot_water');
    expect(wifi?.layers).toEqual({ reviews: 2, found: 0, reported: 0 });
    expect(wifi?.messages).toBe(1);
    expect(water?.layers).toEqual({ reviews: 0, found: 0, reported: 0 });
    expect(water?.messages).toBe(3);
  });

  test('counts stays and episodes of the same places: an archived place has themes, no stays', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ id: 1 })],
        [themeOf({ property_id: 1, reviews: 2 }), themeOf({ property_id: 9, reviews: 50 })],
      ),
      ALL,
    );

    expect(view.portfolio.themes[0].layers.reviews).toBe(2);
    expect(view.portfolio.themes[0].rates).toEqual([
      { layer: 'reviews', episodes: 2, stays: 100, rate: 2 },
    ]);
  });

  test('keeps a theme of the window before alone out of the blocks', () => {
    const view = overviewOf(overviewOfRows([placeOf()], [themeOf({ reviews_prev: 9 })]), ALL);

    expect(view.portfolio.hasThemes).toBe(false);
    expect(view.rows[0].themes).toEqual([]);
  });

  test('lifts the five themes said most, ties in the order of the list', () => {
    const themes = (['heating', 'wifi', 'tv', 'kettle', 'parking', 'smell', 'pests'] as const).map(
      (theme, at) => themeOf({ theme, reviews: at === 6 ? 9 : 1 }),
    );
    const view = overviewOf(overviewOfRows([placeOf()], themes), ALL);

    expect(view.portfolio.themes.map((line) => line.theme)).toEqual([
      'pests',
      'heating',
      'wifi',
      'tv',
      'kettle',
    ]);
    expect(view.portfolio.hasThemes).toBe(true);
  });

  test('weighs each place’s average by its rated reviews', () => {
    const view = overviewOf(
      overviewOfRows(
        [
          placeOf({ id: 1, rating_n: 30, rating_avg: 9 }),
          placeOf({ id: 2, rating_n: 10, rating_avg: 7 }),
          placeOf({ id: 3, rating_n: 0, rating_avg: null }),
        ],
        [],
      ),
      ALL,
    );

    expect(view.tiles.rated).toBe(40);
    expect(view.tiles.average).toBeCloseTo(8.5);
  });

  test('has no average when nothing was rated', () => {
    const view = overviewOf(overviewOfRows([placeOf({ rating_n: 0, rating_avg: null })], []), ALL);

    expect(view.tiles.average).toBeNull();
  });

  test('counts new and returned themes by the state of each place and theme', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ id: 1 }), placeOf({ id: 2 })],
        [
          themeOf({ property_id: 1, theme: 'wifi', reviews: 2, recent: 2 }),
          themeOf({ property_id: 2, theme: 'wifi', reviews: 2, recent: 2 }),
          themeOf({
            property_id: 2,
            theme: 'tv',
            reviews: 1,
            recent: 1,
            last_on: '2026-10-19',
            closed_on: '2026-10-01',
          }),
        ],
      ),
      ALL,
    );

    expect(view.tiles.newThemes).toBe(2);
    expect(view.tiles.returnedThemes).toBe(1);
  });
});

describe('overviewOf: the rate', () => {
  test('a place in a long window with enough stays has one', () => {
    const view = overviewOf(
      overviewOfRows([placeOf({ stays: 76 })], [themeOf({ reviews: 3, recent: 1 })]),
      ALL,
    );

    expect(view.rows[0].themes[0].rates).toEqual([
      { layer: 'reviews', episodes: 3, stays: 76, rate: 3.9 },
    ]);
  });

  test('a place below twenty stays has the count and the reason', () => {
    const view = overviewOf(
      overviewOfRows([placeOf({ stays: 19 })], [themeOf({ reviews: 3, recent: 1 })]),
      ALL,
    );
    const [line] = view.rows[0].themes;

    expect(line.rates).toEqual([]);
    expect(line.rateGap).toBe('few_stays');
  });

  test('a place in a short window has the count whatever its stays', () => {
    const view = overviewOf(
      overviewOfRows([placeOf({ stays: 60 })], [themeOf({ reviews: 3 })], FOURTEEN_DAYS),
      ALL,
    );

    expect(view.rows[0].themes[0].rateGap).toBe('short_window');
  });

  test('the portfolio has one in a short window, where a group has not', () => {
    const view = overviewOf(
      overviewOfRows(FIVE_FLATS, [themeOf({ reviews: 3 })], byCity(FOURTEEN_DAYS)),
      { ...ALL, city: 'Prague' },
    );

    expect(view.portfolio.themes[0].rates).toHaveLength(1);
    expect(view.group?.themes[0].rateGap).toBe('short_window');
  });

  test('a theme guests spoke of reads the complaints alone', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ reviews: 4, found: 2, reported: 1 })]),
      ALL,
    );

    expect(view.rows[0].themes[0].rates.map((rate) => rate.layer)).toEqual(['reviews']);
  });

  test('a theme only staff spoke of gives each of their layers its own rate, never the sum', () => {
    const view = overviewOf(overviewOfRows([placeOf()], [themeOf({ found: 2, reported: 1 })]), ALL);

    expect(view.rows[0].themes[0].rates).toEqual([
      { layer: 'found', episodes: 2, stays: 100, rate: 2 },
      { layer: 'reported', episodes: 1, stays: 100, rate: 1 },
    ]);
  });
});

describe('overviewOf: the trend', () => {
  test('reads the reviews when guests said more over both windows', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf()],
        [themeOf({ reviews: 20, reviews_prev: 5, found: 1, found_prev: 2 })],
        SIX_MONTHS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0]).toMatchObject({ basis: 'reviews', trend: 'rising' });
  });

  test('reads the staff when no guest spoke of the theme', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf()],
        [themeOf({ found: 12, reported: 8, found_prev: 3, reported_prev: 2 })],
        SIX_MONTHS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('rising');
  });

  test('a place below forty stays in either window has too little to say', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ stays: 100, stays_prev: 39 })],
        [themeOf({ reviews: 20, reviews_prev: 1 })],
        SIX_MONTHS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('too_little');
  });

  test('a group of such places says it all the same', () => {
    const flats = FIVE_FLATS.map((flat) => ({
      ...flat,
      stays: 30,
      stays_prev: 30,
      stays_settled: 30,
    }));
    const view = overviewOf(
      overviewOfRows(
        flats,
        flats.map((flat) => themeOf({ property_id: flat.id, reviews: 6, reviews_prev: 1 })),
        byCity(SIX_MONTHS),
      ),
      { ...ALL, city: 'Prague' },
    );

    expect(view.rows[0].themes[0].trend).toBe('too_little');
    expect(view.group?.themes[0].trend).toBe('rising');
    expect(view.portfolio.themes[0].trend).toBe('rising');
  });

  test('a seasonal theme waits for a year at a place, and is compared in a group', () => {
    const view = overviewOf(
      overviewOfRows(
        FIVE_FLATS,
        FIVE_FLATS.map((flat) =>
          themeOf({
            property_id: flat.id,
            theme: 'heating',
            seasonal: true,
            reviews: 10,
            reviews_prev: 1,
          }),
        ),
        byCity(SIX_MONTHS),
      ),
      { ...ALL, city: 'Prague' },
    );

    expect(view.rows[0].themes[0].trend).toBe('seasonal');
    expect(view.group?.themes[0].trend).toBe('rising');
    expect(view.group?.themes[0].seasonal).toBe(true);
  });

  test('is hidden while past reviews are being read', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ reviews: 20, reviews_prev: 5 })], {
        ...SIX_MONTHS,
        history: { ...READ_HISTORY, weeks_done: 14 },
      }),
      ALL,
    );

    expect(view.reading).toEqual({ kind: 'reading', done: 14, total: 49 });
    expect(view.rows[0].themes[0].trend).toBe('hidden');
    expect(view.portfolio.themes[0].trend).toBe('hidden');
  });

  test('is hidden when they were never read: the window before would be empty', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ reviews: 20 })], {
        ...SIX_MONTHS,
        history: { ...READ_HISTORY, enabled: false, weeks_done: 0, weeks_total: null },
      }),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('hidden');
  });

  test('has no base when the window before is older than the staff’s records', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ found: 30 })], {
        ...SIX_MONTHS,
        work_from: '2026-10-19',
      }),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('no_base');
  });

  test('guests are not held to the staff’s records', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ reviews: 20, reviews_prev: 5 })], {
        ...SIX_MONTHS,
        work_from: '2026-10-19',
      }),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('rising');
  });

  test('has no base when the stays of the window before are only partly loaded', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ reviews: 20, reviews_prev: 5 })], {
        ...SIX_MONTHS,
        history: { ...READ_HISTORY, stays_from: '2026-02-01' },
      }),
      ALL,
    );

    expect(view.coverage).toBe('whole');
    expect(view.rows[0].themes[0].trend).toBe('no_base');
  });

  test('twelve months have no window before yet', () => {
    const view = overviewOf(
      overviewOfRows([placeOf({ stays_prev: 0 })], [themeOf({ reviews: 20 })]),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('no_base');
  });
});

describe('overviewOf: who speaks for a theme', () => {
  test('staff, when they said more, though a guest once said something', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf()],
        [themeOf({ theme: 'heating', reviews_prev: 1, found: 30, found_prev: 5 })],
        SIX_MONTHS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0]).toMatchObject({ basis: 'staff', trend: 'rising' });
    expect(view.rows[0].themes[0].rates).toEqual([
      { layer: 'found', episodes: 30, stays: 100, rate: 30 },
    ]);
  });

  test('guests, on a tie', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf()],
        [themeOf({ reviews: 2, reviews_prev: 1, found: 2, found_prev: 1 })],
      ),
      ALL,
    );

    expect(view.rows[0].themes[0].basis).toBe('reviews');
  });

  test('the rate stays per layer whoever speaks', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ reviews: 1, found: 4, reported: 3 })]),
      ALL,
    );

    expect(view.rows[0].themes[0].rates.map((rate) => rate.layer)).toEqual(['found', 'reported']);
  });

  test('when the basis said nothing in the window, the layers that did keep a rate', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ reviews: 2, found_prev: 40 })]),
      ALL,
    );

    expect(view.rows[0].themes[0].basis).toBe('staff');
    expect(view.rows[0].themes[0].rates.map((rate) => rate.layer)).toEqual(['reviews']);
  });

  test('reviews held back are not swapped for the staff’s trend', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf()],
        [themeOf({ reviews: 20, reviews_prev: 10, found: 20, found_prev: 2 })],
        FOURTEEN_DAYS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0]).toMatchObject({ basis: 'reviews', trend: 'reviews_settling' });
  });
});

describe('overviewOf: reviews in a short window', () => {
  test('are not compared at any scope: they are still arriving', () => {
    const view = overviewOf(
      overviewOfRows(
        FIVE_FLATS,
        FIVE_FLATS.map((flat) => themeOf({ property_id: flat.id, reviews: 2, reviews_prev: 30 })),
        byCity(FOURTEEN_DAYS),
      ),
      { ...ALL, city: 'Prague' },
    );

    expect(view.rows[0].themes[0].trend).toBe('reviews_settling');
    expect(view.group?.themes[0].trend).toBe('reviews_settling');
    expect(view.portfolio.themes[0].trend).toBe('reviews_settling');
  });

  test('leave the staff’s trend alone', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ found: 20, found_prev: 5 })], FOURTEEN_DAYS),
      ALL,
    );

    expect(view.rows[0].themes[0]).toMatchObject({ basis: 'staff', trend: 'rising' });
  });

  test('a long window still compares them', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ reviews: 20, reviews_prev: 5 })], SIX_MONTHS),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('rising');
  });
});

describe('overviewOf: reviews compare settled months only', () => {
  test('a month still filling cannot read as a fall', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ stays: 200, stays_settled: 100, stays_prev: 100 })],
        [themeOf({ reviews: 30, reviews_settled: 30, reviews_prev: 30 })],
        SIX_MONTHS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('steady');
  });

  test('a fall in the settled months still reads as one', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ stays: 200, stays_settled: 100, stays_prev: 100 })],
        [themeOf({ reviews: 30, reviews_settled: 5, reviews_prev: 30 })],
        SIX_MONTHS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('falling');
  });

  test('no settled stays is no base', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ stays: 60, stays_settled: 0, stays_prev: 100 })],
        [themeOf({ reviews: 20, reviews_settled: 0, reviews_prev: 5 })],
        SIX_MONTHS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('no_base');
  });

  test('a place is held to forty settled stays, not forty stays', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ stays: 100, stays_settled: 39, stays_prev: 100 })],
        [themeOf({ reviews: 20, reviews_prev: 5 })],
        SIX_MONTHS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('too_little');
  });

  test('counts and rates stay on the whole window', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ stays: 200, stays_settled: 100, stays_prev: 100 })],
        [themeOf({ reviews: 30, reviews_settled: 10, reviews_prev: 30 })],
        SIX_MONTHS,
      ),
      ALL,
    );
    const [line] = view.rows[0].themes;

    expect(line.layers.reviews).toBe(30);
    expect(line.rates).toEqual([{ layer: 'reviews', episodes: 30, stays: 200, rate: 15 }]);
  });

  test('a group and the portfolio add the settled numbers up as well', () => {
    const flats = FIVE_FLATS.map((flat) => ({
      ...flat,
      stays: 40,
      stays_settled: 20,
      stays_prev: 20,
    }));
    const view = overviewOf(
      overviewOfRows(
        flats,
        flats.map((flat) =>
          themeOf({ property_id: flat.id, reviews: 6, reviews_settled: 6, reviews_prev: 6 }),
        ),
        byCity(SIX_MONTHS),
      ),
      { ...ALL, city: 'Prague' },
    );

    expect(view.group?.themes[0].trend).toBe('steady');
    expect(view.portfolio.themes[0].trend).toBe('steady');
  });

  test('staff are not held to settled months', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf({ stays_settled: 0 })],
        [themeOf({ found: 20, found_prev: 5 })],
        SIX_MONTHS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('rising');
  });

  test('a compared trend from reviews says how far it reaches, and nothing else does', () => {
    const view = (theme: ReturnType<typeof themeOf>, meta = SIX_MONTHS) =>
      overviewOf(overviewOfRows([placeOf()], [theme], meta), ALL).rows[0].themes[0];

    expect(view(themeOf({ reviews: 20, reviews_prev: 5 })).settledTo).toBe('2026-09-30');
    expect(view(themeOf({ found: 20, found_prev: 5 })).settledTo).toBeNull();
    expect(view(themeOf({ reviews: 20, reviews_prev: 5 }), FOURTEEN_DAYS).settledTo).toBeNull();
  });
});

describe('overviewOf: the texts’ line', () => {
  const rising = themeOf({ reviews: 20, reviews_prev: 5 });
  const crossing = {
    ...byCity(SIX_MONTHS),
    today: '2027-01-05',
    settled_to: '2026-11-30',
    line: '2026-11-04',
  };

  test('holds back a comparison of reviews across it, at every scope, and names the day', () => {
    const view = overviewOf(
      overviewOfRows(
        FIVE_FLATS,
        FIVE_FLATS.map((flat) => themeOf({ property_id: flat.id, reviews: 20, reviews_prev: 5 })),
        crossing,
      ),
      { ...ALL, city: 'Prague' },
    );

    for (const line of [view.rows[0].themes[0], view.group?.themes[0], view.portfolio.themes[0]]) {
      expect(line).toMatchObject({ trend: 'reviews_seam', seam: '2026-11-04' });
    }
  });

  test('counts from the day itself', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [rising], { ...crossing, settled_to: '2026-11-04' }),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('reviews_seam');
  });

  test('leaves the staff’s trend alone', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ found: 20, found_prev: 5 })], crossing),
      ALL,
    );

    expect(view.rows[0]?.themes[0]).toMatchObject({ trend: 'rising', seam: null });
  });

  test.each([
    ['no line at all', null],
    ['a line older than the window before', '2025-06-01'],
    ['a line the settled months have not reached: one reader on both sides', '2026-11-04'],
    ['a line still to come', '2026-12-01'],
  ])('%s leaves reviews compared', (_case, line) => {
    const view = overviewOf(overviewOfRows([placeOf()], [rising], { ...SIX_MONTHS, line }), ALL);

    expect(view.rows[0].themes[0]).toMatchObject({ trend: 'rising', seam: null });
  });

  test('a short window keeps its own reason', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [rising], { ...FOURTEEN_DAYS, line: '2026-10-10' }),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('reviews_settling');
  });
});

describe('overviewOf: stays that are not there', () => {
  test('a long window with no stays anywhere has them unloaded, not zero', () => {
    const view = overviewOf(
      overviewOfRows([placeOf({ stays: 0, stays_prev: 0 })], [themeOf({ reviews: 3 })], NOT_READ),
      ALL,
    );

    expect(view.coverage).toBe('none');
    expect(view.tiles.stays).toBeNull();
    expect(view.rows[0].stays).toBeNull();
    expect(view.rows[0].trust).toBeNull();
    expect(view.rows[0].themes[0].rateGap).toBe('stays_unknown');
  });

  test('a short window counts bookings: no stays there is a fact', () => {
    const view = overviewOf(
      overviewOfRows([placeOf({ stays: 0, stays_prev: 0 })], [], FOURTEEN_DAYS),
      ALL,
    );

    expect(view.coverage).toBe('whole');
    expect(view.tiles.stays).toBe(0);
  });

  test('a short window with no bookings held has its stays unknown', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ found: 3 })], { ...FOURTEEN_DAYS, held_from: null }),
      ALL,
    );

    expect(view.coverage).toBe('none');
    expect(view.tiles.stays).toBeNull();
    expect(view.rows[0].themes[0].rateGap).toBe('stays_unknown');
  });

  test('bookings held from inside a short window are a part of it', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ found: 3 })], {
        ...FOURTEEN_DAYS,
        held_from: '2026-10-25',
      }),
      ALL,
    );

    expect(view.coverage).toBe('partial');
    expect(view.tiles.stays).toBeNull();
  });

  test('bookings held from inside the window before: the window stands, its trend does not', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ found: 20, found_prev: 5 })], {
        ...FOURTEEN_DAYS,
        held_from: '2026-10-10',
      }),
      ALL,
    );

    expect(view.coverage).toBe('whole');
    expect(view.tiles.stays).toBe(100);
    expect(view.rows[0].themes[0].trend).toBe('no_base');
  });

  test('stays loaded from inside the window are a part of it: no rate on a part', () => {
    const view = overviewOf(
      overviewOfRows([placeOf()], [themeOf({ reviews: 3 })], {
        ...META,
        history: { ...READ_HISTORY, stays_from: '2026-06-01' },
      }),
      ALL,
    );

    expect(view.coverage).toBe('partial');
    expect(view.tiles.stays).toBeNull();
    expect(view.rows[0].themes[0].rates).toEqual([]);
    expect(view.rows[0].themes[0].rateGap).toBe('stays_unknown');
  });
});

describe('overviewOf: the table', () => {
  const places = [
    placeOf({ id: 1, name: 'Quiet flat' }),
    placeOf({ id: 2, name: 'Busy flat' }),
    placeOf({ id: 3, name: 'New flat' }),
    placeOf({ id: 4, name: 'Returned flat' }),
  ];
  const themes = [
    themeOf({ property_id: 1, reviews: 1, last_on: '2023-01-01' }),
    themeOf({ property_id: 2, reviews: 9, open_work: 1 }),
    themeOf({ property_id: 3, reviews: 2, recent: 2 }),
    themeOf({
      property_id: 4,
      reviews: 1,
      recent: 1,
      last_on: '2026-10-19',
      closed_on: '2026-10-01',
    }),
  ];

  test('puts returned and new first, then what is said most', () => {
    const view = overviewOf(overviewOfRows(places, themes), ALL);

    expect(view.rows.map((row) => row.place.name)).toEqual([
      'Returned flat',
      'New flat',
      'Busy flat',
      'Quiet flat',
    ]);
  });

  test('«only new» keeps the places with a new theme', () => {
    const view = overviewOf(overviewOfRows(places, themes), { ...ALL, onlyNew: true });

    expect(view.rows.map((row) => row.place.name)).toEqual(['New flat']);
  });

  test('shows at most three themes of a place, the most important first', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf()],
        [
          themeOf({ theme: 'heating', reviews: 9, open_work: 1 }),
          themeOf({ theme: 'wifi', reviews: 1, recent: 1 }),
          themeOf({ theme: 'tv', reviews: 2, recent: 2 }),
          themeOf({ theme: 'parking', reviews: 3, last_on: '2023-01-01' }),
        ],
      ),
      ALL,
    );

    expect(view.rows[0].themes.map((line) => line.theme)).toEqual(['tv', 'heating', 'wifi']);
  });

  test('reads trust from the place’s stays and rated reviews', () => {
    const view = overviewOf(
      overviewOfRows(
        [
          placeOf({ id: 1, stays: 40, rating_n: 20 }),
          placeOf({ id: 2, stays: 20, rating_n: 0 }),
          placeOf({ id: 3, stays: 19, rating_n: 30 }),
        ],
        [],
      ),
      ALL,
    );

    expect(Object.fromEntries(view.rows.map((row) => [row.place.id, row.trust]))).toEqual({
      1: 'high',
      2: 'medium',
      3: 'low',
    });
  });
});

describe('overviewOf: the city', () => {
  const mixed = [
    ...FIVE_FLATS,
    placeOf({ id: 6, name: 'Brno flat', city: 'Brno' }),
    placeOf({ id: 7, name: 'No city', city: null }),
  ];

  test('offers the cities the places have, sorted', () => {
    expect(overviewOf(overviewOfRows(mixed, [], byCity(META)), ALL).cities).toEqual([
      'Brno',
      'Prague',
    ]);
  });

  test('narrows the table, not the portfolio, and makes a group of five places', () => {
    const view = overviewOf(overviewOfRows(mixed, [], byCity(META)), { ...ALL, city: 'Prague' });

    expect(view.rows).toHaveLength(5);
    expect(view.portfolio.places).toBe(7);
    expect(view.group?.places).toBe(5);
    expect(view.group?.stays).toBe(500);
  });

  test('makes no group of fewer', () => {
    const view = overviewOf(overviewOfRows(mixed, [], byCity(META)), { ...ALL, city: 'Brno' });

    expect(view.city).toBe('Brno');
    expect(view.rows).toHaveLength(1);
    expect(view.group).toBeNull();
  });

  test('a company that does not group by city has no cities, whatever the address says', () => {
    const view = overviewOf(overviewOfRows(mixed, []), { ...ALL, city: 'Prague' });

    expect(view.cities).toEqual([]);
    expect(view.city).toBeNull();
    expect(view.group).toBeNull();
    expect(view.rows).toHaveLength(7);
  });

  test('forgets a city the answer no longer has', () => {
    const view = overviewOf(overviewOfRows(mixed, [], byCity(META)), { ...ALL, city: 'Ostrava' });

    expect(view.city).toBeNull();
    expect(view.rows).toHaveLength(7);
  });
});

describe('overviewOf: what the window has not got', () => {
  test('no places at all', () => {
    expect(overviewOf(overviewOfRows([], []), ALL).empty).toBe('no_places');
  });

  test('no themes on stays that are there', () => {
    expect(overviewOf(overviewOfRows([placeOf()], []), ALL).empty).toBe('no_themes');
  });

  test('no themes on ratings alone', () => {
    const data = overviewOfRows([placeOf({ stays: 0, stays_prev: 0 })], []);

    expect(overviewOf(data, ALL).empty).toBe('no_themes');
  });

  test('nothing at all', () => {
    const data = overviewOfRows(
      [placeOf({ stays: 0, stays_prev: 0, rating_n: 0, rating_avg: null })],
      [],
      FOURTEEN_DAYS,
    );

    expect(overviewOf(data, ALL).empty).toBe('no_data');
  });

  test('stays not read are no proof of nothing at all', () => {
    const blank = placeOf({ stays: 0, stays_prev: 0, rating_n: 0, rating_avg: null });

    expect(overviewOf(overviewOfRows([blank], [], NOT_READ), ALL).empty).toBe('no_themes');
    expect(
      overviewOf(overviewOfRows([blank], [], { ...FOURTEEN_DAYS, held_from: null }), ALL).empty,
    ).toBe('no_themes');
  });

  test('has themes: nothing to explain', () => {
    expect(overviewOf(overviewOfRows([placeOf()], [themeOf({ found: 1 })]), ALL).empty).toBeNull();
  });
});

describe('placeCardOf', () => {
  test('lifts new, returned and growing themes, and leaves the rest below', () => {
    const view = placeCardOf(
      cardOf({
        ...SIX_MONTHS,
        themes: [
          themeOf({ theme: 'heating', reviews: 1, recent: 1 }),
          themeOf({ theme: 'wifi', reviews: 2, recent: 2 }),
          themeOf({
            theme: 'tv',
            reviews: 1,
            recent: 1,
            last_on: '2026-10-19',
            closed_on: '2026-10-01',
          }),
          themeOf({ theme: 'parking', reviews: 20, reviews_prev: 5, recent: 1, work_180: 1 }),
          themeOf({ theme: 'kettle', reviews: 1, open_work: 1 }),
        ],
      }),
    );

    expect(view.important.map((line) => line.theme)).toEqual(['tv', 'wifi', 'parking']);
    expect(view.others.map((line) => line.theme)).toEqual(['kettle', 'heating']);
  });

  test('lifts five at most: the sixth goes below', () => {
    const codes = ['heating', 'wifi', 'tv', 'kettle', 'parking', 'smell'] as const;
    const view = placeCardOf(
      cardOf({ themes: codes.map((theme) => themeOf({ theme, reviews: 2, recent: 2 })) }),
    );

    expect(view.important).toHaveLength(5);
    expect(view.others).toHaveLength(1);
  });

  test('keeps a theme with live work on it, though nothing was said of it in the window', () => {
    const view = placeCardOf(cardOf({ themes: [themeOf({ open_work: 1, reviews_prev: 2 })] }));

    expect(view.empty).toBeNull();
    expect(view.others[0]).toMatchObject({ state: 'in_work', rates: [], rateGap: null });
  });

  test('marks an episode older than the record of repairs', () => {
    const old = cardOf({
      work_from: '2026-10-19',
      themes: [themeOf({ reviews: 1, last_on: '2026-03-01' })],
    });
    const fresh = cardOf({
      work_from: '2026-10-19',
      themes: [themeOf({ reviews: 1, last_on: '2026-10-19' })],
    });

    expect(placeCardOf(old).hasOldEpisodes).toBe(true);
    expect(placeCardOf(old).others[0].state).toBe('no_repair_data');
    expect(placeCardOf(fresh).hasOldEpisodes).toBe(false);
  });

  test('a card with no record of repairs at all marks every old episode', () => {
    const card = cardOf({ work_from: null, themes: [themeOf({ reviews: 1 })] });

    expect(placeCardOf(card).hasOldEpisodes).toBe(true);
  });

  test('tells no themes on stays from no data at all', () => {
    const quiet = cardOf();
    const blank = cardOf({
      ...FOURTEEN_DAYS,
      place: placeOf({ stays: 0, stays_prev: 0, rating_n: 0, rating_avg: null }),
    });

    expect(placeCardOf(quiet).empty).toBe('no_themes');
    expect(placeCardOf(blank).empty).toBe('no_data');
  });

  test('stays not read are no proof of nothing at all', () => {
    const view = placeCardOf(
      cardOf({
        ...NOT_READ,
        place: placeOf({ stays: 0, stays_prev: 0, rating_n: 0, rating_avg: null }),
      }),
    );

    expect(view.empty).toBe('no_themes');
  });

  test('a place that really stood empty, once stays are read, shows its zero', () => {
    const view = placeCardOf(cardOf({ place: placeOf({ stays: 0, stays_prev: 0 }) }));

    expect(view.coverage).toBe('whole');
    expect(view.stays).toBe(0);
  });

  test('a year of episodes is something, though the window has no theme', () => {
    const view = placeCardOf(
      cardOf({
        ...FOURTEEN_DAYS,
        place: placeOf({ stays: 0, stays_prev: 0, rating_n: 0, rating_avg: null }),
        months: [{ month: '2026-03-01', theme: 'wifi', layer: 'guest_review', n: 1 }],
      }),
    );

    expect(view.empty).toBe('no_themes');
  });

  test('reads a long window’s zero as the overview does: not loaded, never «0»', () => {
    const place = placeOf({ stays: 0, stays_prev: 0 });

    const card = placeCardOf(cardOf({ ...NOT_READ, place }));
    const overview = overviewOf(overviewOfRows([place], [], NOT_READ), ALL);

    expect(card.coverage).toBe('none');
    expect(card.coverage).toBe(overview.coverage);
    expect(card.stays).toBeNull();
    expect(card.trust).toBeNull();
  });

  test('a short window’s zero is a fact on the card too', () => {
    const view = placeCardOf(
      cardOf({ ...FOURTEEN_DAYS, place: placeOf({ stays: 0, stays_prev: 0 }) }),
    );

    expect(view.coverage).toBe('whole');
    expect(view.stays).toBe(0);
    expect(view.trust).toBe('low');
  });

  test('a short window with no bookings held is unknown on the card too', () => {
    const view = placeCardOf(cardOf({ ...FOURTEEN_DAYS, held_from: null }));

    expect(view.coverage).toBe('none');
    expect(view.stays).toBeNull();
  });

  test('no month read at all leaves the stays unknown', () => {
    const view = placeCardOf(
      cardOf({
        history: { ...READ_HISTORY, stays_from: null, stay_months: 0 },
        place: placeOf({ stays: 0, stays_prev: 0 }),
      }),
    );

    expect(view.coverage).toBe('none');
    expect(view.stays).toBeNull();
    expect(view.trust).toBeNull();
  });
});

describe('monthBarsOf', () => {
  const rows = [
    { month: '2026-10-01', theme: 'wifi', layer: 'guest_review', n: 2 },
    { month: '2026-10-01', theme: 'tv', layer: 'guest_review', n: 1 },
    { month: '2026-10-01', theme: 'tv', layer: 'staff_report', n: 4 },
    { month: '2026-03-01', theme: 'wifi', layer: 'found_at_work', n: 3 },
  ] as const;

  test('counts the themes of a month by layer', () => {
    const bars = monthBarsOf(rows, '2026-11-06');

    expect(bars.find((bar) => bar.month === '2026-10-01')).toEqual({
      month: '2026-10-01',
      reviews: 3,
      found: 0,
      reported: 4,
    });
    expect(bars.find((bar) => bar.month === '2026-03-01')).toEqual({
      month: '2026-03-01',
      reviews: 0,
      found: 3,
      reported: 0,
    });
  });

  test('stands the twelve months ending at today in order, a quiet one at zero', () => {
    const bars = monthBarsOf(rows, '2026-11-06');

    expect(bars).toHaveLength(12);
    expect(bars[0].month).toBe('2025-12-01');
    expect(bars.at(-1)?.month).toBe('2026-11-01');
    expect(bars.find((bar) => bar.month === '2026-05-01')).toEqual({
      month: '2026-05-01',
      reviews: 0,
      found: 0,
      reported: 0,
    });
  });

  test('goes back across a new year', () => {
    const bars = monthBarsOf(rows, '2026-01-15');

    expect(bars[0].month).toBe('2025-02-01');
    expect(bars.at(-1)?.month).toBe('2026-01-01');
  });

  test('a year with no episode has no bars to draw', () => {
    expect(monthBarsOf([], '2026-11-06')).toEqual([]);
  });
});
