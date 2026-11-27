import { CLEANER_ANNA, STAFF, TECH_IVAN } from '@/testing/board-fixtures';
import { ROYAL_ROOM, officeTask } from '@/testing/office-fixtures';

import {
  MAX_RANGE_DAYS,
  activeCleaners,
  canAssignCleaning,
  canRestoreCleaning,
  dayMarks,
  filterOffice,
  groupOfficeByDay,
  isRangeAllowed,
  matchesStatus,
  officeTaskSchema,
  placeKey,
  placesOf,
  rangeOfDate,
  rangeOfMonth,
} from '../schema';

/**
 * The office's cleanings, read and sorted: the row as the office reads it, the
 * days a filter covers, the status chips, the places, the days of a month grid,
 * and what the office may do with one cleaning.
 */

const ID_2 = '4a3b2c1d-6e5f-4a7b-8c9d-0e1f2a3b4c5d';
const ID_3 = '5b4c3d2e-7f60-4b8c-9dae-1f2a3b4c5d6e';

describe('the row the office reads', () => {
  test('carries the person’s name, the cancel’s stamp and who took it off', () => {
    const row = officeTaskSchema.parse({
      ...officeTask(),
      cancelled_at: '2026-11-18T09:40:00+00:00',
      release_kind: 'declined',
      offs: {
        cancelled: null,
        released: {
          kind: 'declined',
          at: '2026-11-18T08:00:00+00:00',
          by: { id: CLEANER_ANNA, name: 'Анна Белова', role: 'cleaner' },
          reason: 'Заболела',
        },
      },
    });

    expect(row.assignee?.full_name).toBe('Анна Белова');
    expect(row.release_kind).toBe('declined');
    expect(row.offs?.released?.reason).toBe('Заболела');
  });

  // A copy a cleaner's read saved, or an older build's, has none of the office's keys.
  test('a row without the office’s keys reads as «not known», never as a failure', () => {
    const { assignee, cancelled_at, release_kind, offs, ...cleanerRow } = officeTask();
    void [assignee, cancelled_at, release_kind, offs];

    const row = officeTaskSchema.parse(cleanerRow);

    expect(row).toMatchObject({ assignee: null, cancelled_at: null, release_kind: null, offs: null });
  });

  test('a kind of hand-back this build does not know is no hand-back', () => {
    const row = officeTaskSchema.parse({ ...officeTask(), release_kind: 'vanished' });

    expect(row.release_kind).toBeNull();
  });
});

describe('the days a filter covers', () => {
  const TODAY = '2026-11-18';

  test.each([
    ['today', null, '2026-11-18', '2026-11-19'],
    ['tomorrow', null, '2026-11-19', '2026-11-20'],
    ['week', null, '2026-11-18', '2026-11-25'],
    ['day', '2026-12-03', '2026-12-03', '2026-12-04'],
  ] as const)('%s covers %s..%s', (choice, day, from, to) => {
    expect(rangeOfDate({ choice, day }, TODAY)).toEqual({ from, to });
  });

  test('a month covers its own days, December into January', () => {
    expect(rangeOfMonth('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });

  test(`one read covers 1 to ${MAX_RANGE_DAYS} days`, () => {
    expect(isRangeAllowed({ from: '2026-11-01', to: '2026-11-02' })).toBe(true);
    expect(isRangeAllowed({ from: '2026-11-01', to: '2027-01-02' })).toBe(true);
    expect(isRangeAllowed({ from: '2026-11-01', to: '2027-01-03' })).toBe(false);
    expect(isRangeAllowed({ from: '2026-11-02', to: '2026-11-02' })).toBe(false);
  });
});

describe('the status chips', () => {
  test('«Все» leaves the cancelled out, as the panel does; «Отменённые» shows only them', () => {
    expect(matchesStatus({ status: 'cancelled' }, 'all')).toBe(false);
    expect(matchesStatus({ status: 'expired' }, 'all')).toBe(true);
    expect(matchesStatus({ status: 'cancelled' }, 'cancelled')).toBe(true);
    expect(matchesStatus({ status: 'done' }, 'cancelled')).toBe(false);
  });

  test('«Назначены» holds the accepted, «В работе» the paused and the blocked', () => {
    expect(matchesStatus({ status: 'accepted' }, 'assigned')).toBe(true);
    expect(matchesStatus({ status: 'paused' }, 'in_progress')).toBe(true);
    expect(matchesStatus({ status: 'blocked' }, 'in_progress')).toBe(true);
    expect(matchesStatus({ status: 'unassigned' }, 'assigned')).toBe(false);
  });
});

describe('the places', () => {
  const rows = [
    officeTask(),
    officeTask({ id: ID_2, property_id: 2109, property: ROYAL_ROOM }),
    officeTask({ id: ID_3, property_id: 2110, property: { ...ROYAL_ROOM, name: '2 - 2110' } }),
  ];

  test('a room is filtered by its house', () => {
    expect(placeKey(rows[1])).toBe('CZ - Vinohradska Royal');
    expect(placeKey(officeTask({ property: null, property_id: 7 }))).toBe('#7');
  });

  test('the places of the rows read, by name, with how many stand there', () => {
    expect(placesOf(rows)).toEqual([
      { key: 'CZ - Nadrazni Apt 6', count: 1 },
      { key: 'CZ - Vinohradska Royal', count: 2 },
    ]);
  });

  test('the filters keep what matches both', () => {
    const cancelled = officeTask({ id: ID_3, status: 'cancelled', property: ROYAL_ROOM });

    expect(
      filterOffice([...rows.slice(0, 2), cancelled], {
        status: 'all',
        place: 'CZ - Vinohradska Royal',
      }).map((task) => task.id),
    ).toEqual([ID_2]);
  });
});

describe('days', () => {
  const rows = [
    officeTask({ id: ID_2, scheduled_date: '2026-11-19', status: 'unassigned', assignee_id: null }),
    officeTask(),
    officeTask({ id: ID_3, scheduled_date: '2026-11-19' }),
  ];

  test('a section per day, the nearest first; one flat’s rows of one window as they came', () => {
    const days = groupOfficeByDay(rows);

    expect(days.map((day) => day.key)).toEqual(['2026-11-18', '2026-11-19']);
    expect(days[1].data.map((task) => task.id)).toEqual([ID_2, ID_3]);
  });

  test('inside a day the flats by name, a room under its house (owner, 2026-11-27)', () => {
    const days = groupOfficeByDay(
      [
        officeTask({ id: ID_2, time_from: '08:00:00' }),
        officeTask({ id: ID_3, time_from: '12:00:00', property: ROYAL_ROOM }),
        officeTask({ time_from: '09:00:00', property: { ...ROYAL_ROOM, name: '2 - 2110' } }),
      ],
      'ru',
    );

    // «CZ - Nadrazni Apt 6» before «CZ - Vinohradska Royal — 1 - 2109», then «… — 2 - 2110».
    expect(days[0].data.map((task) => task.id)).toEqual([ID_2, ID_3, officeTask().id]);
  });

  test('the grid counts a day’s cleanings and marks one waiting for a person', () => {
    expect(dayMarks(rows)).toEqual({
      '2026-11-18': { count: 1, isAttention: false },
      '2026-11-19': { count: 2, isAttention: true },
    });
  });
});

describe('what the office may do', () => {
  test.each(['unassigned', 'assigned', 'accepted', 'in_progress', 'paused', 'blocked'] as const)(
    'a %s cleaning can be given to somebody',
    (status) => {
      expect(canAssignCleaning(officeTask({ status }))).toBe(true);
    },
  );

  test.each(['done', 'cancelled', 'expired'] as const)('a %s one cannot', (status) => {
    expect(canAssignCleaning(officeTask({ status }))).toBe(false);
  });

  test('a repair is handed out on its task’s screen; a row not read whole offers nothing', () => {
    expect(canAssignCleaning(officeTask({ problem_id: ID_2 }))).toBe(false);
    expect(canAssignCleaning(officeTask({ problem_id: undefined }))).toBe(false);
  });

  test('«Вернуть» only on a cancel the office made', () => {
    const at = '2026-11-18T09:40:00+00:00';

    expect(canRestoreCleaning(officeTask({ status: 'cancelled', cancelled_at: at }))).toBe(true);
    expect(canRestoreCleaning(officeTask({ status: 'cancelled', cancelled_at: null }))).toBe(false);
    expect(canRestoreCleaning(officeTask({ status: 'assigned', cancelled_at: null }))).toBe(false);
  });

  test('a cleaning is offered to the cleaners at work only', () => {
    expect(activeCleaners(STAFF).map((person) => person.id)).toEqual([CLEANER_ANNA]);
    expect(activeCleaners(STAFF).some((person) => person.id === TECH_IVAN)).toBe(false);
  });
});
