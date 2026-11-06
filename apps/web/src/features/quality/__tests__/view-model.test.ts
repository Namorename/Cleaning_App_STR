import { describe, expect, test } from 'vitest';

import { readingOf } from '../theme-model';
import { monthBarsOf, overviewOf, placeCardOf, type OverviewFilters } from '../view-model';
import {
  cardOf,
  FOURTEEN_DAYS,
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
    const view = overviewOf(overviewOfRows(FIVE_FLATS, [themeOf({ reviews: 3 })], FOURTEEN_DAYS), {
      ...ALL,
      city: 'Prague',
    });

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
  test('reads the reviews of a theme guests spoke of in either window', () => {
    const view = overviewOf(
      overviewOfRows(
        [placeOf()],
        [themeOf({ reviews: 20, reviews_prev: 5, found: 0, found_prev: 40 })],
        SIX_MONTHS,
      ),
      ALL,
    );

    expect(view.rows[0].themes[0].trend).toBe('rising');
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
    const flats = FIVE_FLATS.map((flat) => ({ ...flat, stays: 30, stays_prev: 30 }));
    const view = overviewOf(
      overviewOfRows(
        flats,
        flats.map((flat) => themeOf({ property_id: flat.id, reviews: 6, reviews_prev: 1 })),
        SIX_MONTHS,
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
        SIX_MONTHS,
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

describe('overviewOf: stays that are not there', () => {
  test('a long window with no stays anywhere has them unloaded, not zero', () => {
    const view = overviewOf(
      overviewOfRows([placeOf({ stays: 0, stays_prev: 0 })], [themeOf({ reviews: 3 })]),
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
    expect(overviewOf(overviewOfRows(mixed, []), ALL).cities).toEqual(['Brno', 'Prague']);
  });

  test('narrows the table, not the portfolio, and makes a group of five places', () => {
    const view = overviewOf(overviewOfRows(mixed, []), { ...ALL, city: 'Prague' });

    expect(view.rows).toHaveLength(5);
    expect(view.portfolio.places).toBe(7);
    expect(view.group?.places).toBe(5);
    expect(view.group?.stays).toBe(500);
  });

  test('makes no group of fewer', () => {
    const view = overviewOf(overviewOfRows(mixed, []), { ...ALL, city: 'Brno' });

    expect(view.city).toBe('Brno');
    expect(view.rows).toHaveLength(1);
    expect(view.group).toBeNull();
  });

  test('forgets a city the answer no longer has', () => {
    const view = overviewOf(overviewOfRows(mixed, []), { ...ALL, city: 'Ostrava' });

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
    );

    expect(overviewOf(data, ALL).empty).toBe('no_data');
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
      place: placeOf({ stays: 0, stays_prev: 0, rating_n: 0, rating_avg: null }),
    });

    expect(placeCardOf(quiet).empty).toBe('no_themes');
    expect(placeCardOf(blank).empty).toBe('no_data');
  });

  test('a place with no stays where they are loaded has zero, not an unknown', () => {
    const view = placeCardOf(cardOf({ place: placeOf({ stays: 0, stays_prev: 0 }) }));

    expect(view.coverage).toBe('whole');
    expect(view.stays).toBe(0);
    expect(view.trust).toBe('low');
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
  test('counts the themes of a month by layer, the months present, oldest first', () => {
    expect(
      monthBarsOf([
        { month: '2026-10-01', theme: 'wifi', layer: 'guest_review', n: 2 },
        { month: '2026-10-01', theme: 'tv', layer: 'guest_review', n: 1 },
        { month: '2026-10-01', theme: 'tv', layer: 'staff_report', n: 4 },
        { month: '2026-03-01', theme: 'wifi', layer: 'found_at_work', n: 3 },
      ]),
    ).toEqual([
      { month: '2026-03-01', reviews: 0, found: 3, reported: 0 },
      { month: '2026-10-01', reviews: 3, found: 0, reported: 4 },
    ]);
  });
});
