import {
  comparePlaces,
  compareQueue,
  orderByDayAndPlace,
  orderCleanings,
  orderQueue,
  orderTaskHistory,
  placeCollator,
  queuePlace,
  type CleaningOrderFacts,
  type QueueFacts,
} from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

/**
 * The order of the day lists of both apps (owner, 2026-11-27; packages/shared,
 * schedule/day-place-order.ts): the day, then the property by name as the list shows it, a row
 * with no property last in its day, then each kind's own tie-break. Run here because the shared
 * package has no runner of its own.
 */

const sortNames = (names: readonly string[], language: string) =>
  [...names].sort((left, right) => comparePlaces(left, right, language));

describe('the names of properties', () => {
  test('numbers inside a name count by their value', () => {
    expect(sortNames(['Apt 10', 'Apt 2', 'Apt 1'], 'en')).toEqual(['Apt 1', 'Apt 2', 'Apt 10']);
    expect(sortNames(['3-3008', '3-310', '3-302', '3-30'], 'en')).toEqual([
      '3-30',
      '3-302',
      '3-310',
      '3-3008',
    ]);
  });

  test('case and accents aside', () => {
    expect(sortNames(['APT 3', 'apt 2', 'Apt 4'], 'en')).toEqual(['apt 2', 'APT 3', 'Apt 4']);
    expect(comparePlaces('Résidence', 'residence', 'en')).toBe(0);
    expect(comparePlaces('Ёлка', 'елка', 'ru')).toBe(0);
  });

  test('by the alphabet of the interface language', () => {
    // Czech: «č» is a letter of its own after «c», and «ch» comes after «h».
    expect(sortNames(['Hotel', 'Chata', 'Čáp', 'Cukr'], 'cs')).toEqual([
      'Cukr',
      'Čáp',
      'Hotel',
      'Chata',
    ]);
    expect(sortNames(['Hotel', 'Chata', 'Čáp', 'Cukr'], 'en')).toEqual([
      'Čáp',
      'Chata',
      'Cukr',
      'Hotel',
    ]);
    expect(sortNames(['Жук', 'Дом', 'Ёлка', 'Арбат'], 'ru')).toEqual([
      'Арбат',
      'Дом',
      'Ёлка',
      'Жук',
    ]);
  });

  test('a missing or blank name stands after every named one', () => {
    expect(comparePlaces(null, 'Apt 1', 'en')).toBeGreaterThan(0);
    expect(comparePlaces('Apt 1', undefined, 'en')).toBeLessThan(0);
    expect(comparePlaces('   ', 'Apt 1', 'en')).toBeGreaterThan(0);
    expect(comparePlaces(null, '', 'en')).toBe(0);
  });

  test('a language tag with a region, or one the apps do not speak, still orders', () => {
    expect(placeCollator('cs-CZ').compare('Hotel', 'Chata')).toBeLessThan(0);
    expect(placeCollator('de').compare('Apt 2', 'Apt 10')).toBeLessThan(0);
    expect(placeCollator(null).compare('Apt 2', 'Apt 10')).toBeLessThan(0);
    expect(placeCollator('en')).toBe(placeCollator('en-GB'));
  });
});

interface Row {
  readonly name: string;
  readonly day: string;
  readonly place: string | null;
  readonly rank?: number;
}

const row = (name: string, day: string, place: string | null, rank = 0): Row => ({
  name,
  day,
  place,
  rank,
});

const names = (rows: readonly { readonly name: string }[]) => rows.map((one) => one.name);

describe('the order of a day list', () => {
  const rows = [
    row('b 27', '2026-11-27', 'Beta'),
    row('none 26', '2026-11-26', null),
    row('a 26', '2026-11-26', 'alpha'),
    row('a 27', '2026-11-27', 'Alpha'),
    row('c 26', '2026-11-26', 'Charlie'),
  ];
  const order = {
    day: (one: Row) => one.day,
    place: (one: Row) => one.place,
  };

  test('the day first, then the property; one with no property last in its day', () => {
    expect(names(orderByDayAndPlace(rows, { ...order, language: 'en' }))).toEqual([
      'a 26',
      'c 26',
      'none 26',
      'a 27',
      'b 27',
    ]);
  });

  test('a history keeps the later day first, the properties still A to Z within it', () => {
    expect(
      names(orderByDayAndPlace(rows, { ...order, language: 'en', days: 'later-first' })),
    ).toEqual(['a 27', 'b 27', 'a 26', 'c 26', 'none 26']);
  });

  test('rows of one property follow the tie-break, else keep the order given', () => {
    const same = [row('second', '2026-11-26', 'Apt 1', 2), row('first', '2026-11-26', 'apt 1', 1)];
    expect(
      names(
        orderByDayAndPlace(same, {
          ...order,
          then: (left, right) => (left.rank ?? 0) - (right.rank ?? 0),
        }),
      ),
    ).toEqual(['first', 'second']);
    expect(names(orderByDayAndPlace(same, order))).toEqual(['second', 'first']);
  });

  test('hands back a new array and leaves the one given as it was', () => {
    const ordered = orderByDayAndPlace(rows, order);
    expect(ordered).not.toBe(rows);
    expect(names(rows)).toEqual(['b 27', 'none 26', 'a 26', 'a 27', 'c 26']);
  });
});

interface Task extends QueueFacts {
  readonly name: string;
}

const PRAGUE = 'Europe/Prague';

const task = (name: string, place: string | null, facts: Partial<QueueFacts> = {}): Task => ({
  name,
  priority: 'normal',
  created_at: '2026-11-26T10:00:00Z',
  property: place === null ? null : { timezone: PRAGUE, name: place },
  ...facts,
});

describe('the technicians’ tasks', () => {
  test('within a day by property, before the level', () => {
    const ordered = orderQueue(
      [
        task('critical in Žižkov', 'Žižkov 5', { priority: 'high', critical: true }),
        task('low in Apt 10', 'Apt 10', { priority: 'low' }),
        task('normal in Apt 2', 'Apt 2'),
      ],
      { language: 'cs' },
    );
    expect(names(ordered)).toEqual(['normal in Apt 2', 'low in Apt 10', 'critical in Žižkov']);
  });

  test('one property: critical first, then the older', () => {
    const ordered = orderQueue([
      task('newer normal', 'Apt 1', { created_at: '2026-11-26T12:00:00Z' }),
      task('older normal', 'apt 1', { created_at: '2026-11-26T08:00:00Z' }),
      task('critical', 'APT 1', { priority: 'high', critical: true }),
    ]);
    expect(names(ordered)).toEqual(['critical', 'older normal', 'newer normal']);
  });

  test('a task with no property after the named ones of its day, before the next day', () => {
    const ordered = orderQueue([
      task('tomorrow', 'Apt 1', { due_on: '2026-11-27' }),
      task('nowhere', null, { priority: 'high', critical: true }),
      task('Zeta', 'Zeta'),
    ]);
    expect(names(ordered)).toEqual(['Zeta', 'nowhere', 'tomorrow']);
  });

  test('a room reads under its house, as the list shows it', () => {
    const room = task('room', null, {
      property: { timezone: PRAGUE, name: '2109', hostaway_unit_id: 7, parent: { name: 'Main' } },
    });
    expect(queuePlace(room)).toBe('Main — 2109');
    const ordered = orderQueue([room, task('house B', 'B house'), task('house M', 'Main')]);
    expect(names(ordered)).toEqual(['house B', 'house M', 'room']);
  });

  test('a row an older build cached, without the property’s name, reads as no property', () => {
    const cached = task('cached', null, { property: { timezone: PRAGUE } });
    expect(queuePlace(cached)).toBeNull();
    expect(names(orderQueue([cached, task('named', 'Apt 1')]))).toEqual(['named', 'cached']);
  });

  test('a list may name the property its own way', () => {
    const ordered = orderQueue([task('one', 'Zeta'), task('two', 'Alpha')], {
      place: (one) => (one.name === 'one' ? 'A' : 'B'),
    });
    expect(names(ordered)).toEqual(['one', 'two']);
  });

  test('compareQueue agrees with orderQueue', () => {
    const given = [
      task('Apt 10', 'Apt 10'),
      task('Apt 2', 'Apt 2'),
      task('nowhere', null),
      task('earlier', 'Zeta', { created_at: '2026-11-25T10:00:00Z' }),
    ];
    expect(names([...given].sort((left, right) => compareQueue(left, right, 'en')))).toEqual(
      names(orderQueue(given, { language: 'en' })),
    );
  });

  // The owner, 2026-11-27 («Задания не отсортированы»): a board card shows the technician's day,
  // so a task with live work stands on it, over its planned day and the day it was made.
  test('a list that shows the work’s day stands a task on it', () => {
    const workDays: Readonly<Record<string, string>> = {
      curtains: '2026-11-28',
      dishwasher: '2026-11-29',
      sofa: '2026-11-29',
      bulb: '2026-11-26',
    };
    const given = [
      task('curtains', 'Skolska - ap.1A', { created_at: '2026-10-25T10:00:00Z' }),
      task('dishwasher', 'Skolska - Ap.2', { created_at: '2026-10-26T10:00:00Z' }),
      task('sofa', 'Ostrovni 7 Apt 13', { created_at: '2026-10-30T10:00:00Z' }),
      task('bulb', 'Skolska - ap.6', { created_at: '2026-10-31T10:00:00Z', due_on: '2026-12-01' }),
      task('no work', 'Alpha', { created_at: '2026-10-01T10:00:00Z', due_on: '2026-11-27' }),
    ];

    const onWork = orderQueue(given, { language: 'en', workDay: (one) => workDays[one.name] });
    expect(names(onWork)).toEqual(['bulb', 'no work', 'curtains', 'sofa', 'dishwasher']);
    // Without it, as before: the planned day, else the day made.
    expect(names(orderQueue(given, { language: 'en' }))).toEqual([
      'curtains',
      'dishwasher',
      'sofa',
      'no work',
      'bulb',
    ]);
  });
});

describe('a history of tasks', () => {
  test('the later day first, the property within it, then the level, then the newer', () => {
    const ordered = orderTaskHistory(
      [
        task('25th', 'Apt 1', { created_at: '2026-11-25T10:00:00Z' }),
        task('26th Apt 10', 'Apt 10', { created_at: '2026-11-26T09:00:00Z' }),
        task('26th Apt 2 older', 'Apt 2', { created_at: '2026-11-26T08:00:00Z' }),
        task('26th Apt 2 newer', 'apt 2', { created_at: '2026-11-26T12:00:00Z' }),
        task('26th Apt 2 critical', 'Apt 2', {
          priority: 'high',
          critical: true,
          created_at: '2026-11-26T07:00:00Z',
        }),
        task('26th nowhere', null, { created_at: '2026-11-26T13:00:00Z' }),
      ],
      { language: 'en' },
    );
    expect(names(ordered)).toEqual([
      '26th Apt 2 critical',
      '26th Apt 2 newer',
      '26th Apt 2 older',
      '26th Apt 10',
      '26th nowhere',
      '25th',
    ]);
  });

  test('counts by the instant it is told, in the listing’s zone', () => {
    const resolvedAt = (one: Task & { resolved: string }) => one.resolved;
    const ordered = orderTaskHistory(
      [
        // Resolved at 23:30 UTC on the 26th: already the 27th in Prague.
        { ...task('late', 'Zeta'), resolved: '2026-11-26T23:30:00Z' },
        { ...task('early', 'Alpha'), resolved: '2026-11-26T09:00:00Z' },
      ],
      { at: resolvedAt },
    );
    expect(names(ordered)).toEqual(['late', 'early']);
  });
});

interface Cleaning extends CleaningOrderFacts {
  readonly name: string;
  readonly property: string | null;
}

const cleaning = (
  name: string,
  property: string | null,
  facts: Partial<CleaningOrderFacts> = {},
): Cleaning => ({
  name,
  property,
  scheduled_date: '2026-11-27',
  time_from: '11:00:00',
  created_at: '2026-11-20T10:00:00Z',
  ...facts,
});

describe('the cleanings', () => {
  const place = (one: Cleaning) => one.property;

  test('within a day by property, before the time', () => {
    const ordered = orderCleanings(
      [
        cleaning('Apt 10 morning', 'Apt 10', { time_from: '08:00:00' }),
        cleaning('Apt 2 noon', 'Apt 2', { time_from: '12:00:00' }),
        cleaning('yesterday', 'Zeta', { scheduled_date: '2026-11-26' }),
      ],
      { place, language: 'en' },
    );
    expect(names(ordered)).toEqual(['yesterday', 'Apt 2 noon', 'Apt 10 morning']);
  });

  test('one property: the earlier start, one without a time last, then the one made first', () => {
    const ordered = orderCleanings(
      [
        cleaning('no time', 'Apt 1', { time_from: null }),
        cleaning('noon, newer', 'Apt 1', {
          time_from: '12:00:00',
          created_at: '2026-11-22T10:00Z',
        }),
        cleaning('noon, older', 'apt 1', {
          time_from: '12:00:00',
          created_at: '2026-11-21T10:00Z',
        }),
        cleaning('morning', 'APT 1', { time_from: '08:30:00' }),
      ],
      { place },
    );
    expect(names(ordered)).toEqual(['morning', 'noon, older', 'noon, newer', 'no time']);
  });

  test('one with no property last in its day', () => {
    const ordered = orderCleanings(
      [cleaning('nowhere', null, { time_from: '06:00:00' }), cleaning('Zeta', 'Zeta')],
      { place },
    );
    expect(names(ordered)).toEqual(['Zeta', 'nowhere']);
  });

  test('a history: the later day first, A to Z within it', () => {
    const ordered = orderCleanings(
      [
        cleaning('26 B', 'B', { scheduled_date: '2026-11-26' }),
        cleaning('27 B', 'B'),
        cleaning('26 A', 'A', { scheduled_date: '2026-11-26' }),
        cleaning('27 A', 'a'),
      ],
      { place, days: 'later-first' },
    );
    expect(names(ordered)).toEqual(['27 A', '27 B', '26 A', '26 B']);
  });

  test('Czech names in Czech order, Russian in Russian', () => {
    const czech = orderCleanings(
      [cleaning('ch', 'Chalupa'), cleaning('h', 'Horní'), cleaning('c', 'Cihelna')],
      { place, language: 'cs' },
    );
    expect(names(czech)).toEqual(['c', 'h', 'ch']);
    const russian = orderCleanings(
      [cleaning('ж', 'Жуковка'), cleaning('а', 'арбат 12'), cleaning('а2', 'Арбат 2')],
      { place, language: 'ru' },
    );
    expect(names(russian)).toEqual(['а2', 'а', 'ж']);
  });

  test('a row an older build cached, without a time or a creation, still orders', () => {
    const bare: Cleaning = { name: 'bare', property: 'Apt 1', scheduled_date: '2026-11-27' };
    const ordered = orderCleanings([bare, cleaning('timed', 'Apt 1')], { place });
    expect(names(ordered)).toEqual(['timed', 'bare']);
  });
});
