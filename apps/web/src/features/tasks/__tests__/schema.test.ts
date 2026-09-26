import { describe, expect, test } from 'vitest';

import {
  draftFromTask,
  EMPTY_FILTERS,
  hasFilters,
  groupTasks,
  isAssigneeMissing,
  isDraftReady,
  isManualTask,
  localizedTitle,
  matchesFilters,
  matchesQuery,
  needsAssignee,
  propertyOptions,
  tabOf,
  tailOf,
  taskMinutes,
  taskPropertyName,
  taskSchema,
  timeGroup,
  type Task,
} from '../schema';

const TODAY = '2026-09-11';

const base = {
  property_id: 1,
  reservation_id: null,
  problem_id: null,
  type: 'cleaning',
  status: 'assigned',
  priority: 0,
  assignee_id: null,
  created_by: null,
  scheduled_date: TODAY,
  time_from: null,
  time_to: null,
  started_at: null,
  completed_at: null,
  measured_minutes: null,
  duration_override_min: null,
  is_parallel: false,
  is_short_measurement: null,
  notes: null,
  title: null,
  title_i18n: null,
  created_at: '2026-09-10T08:00:00+00:00',
};

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`;

const task = (overrides: Partial<Task> & { id: string }): Task =>
  taskSchema.parse({ ...base, ...overrides });

describe('tabOf', () => {
  test('puts work of today in today', () => {
    expect(tabOf({ status: 'assigned', scheduled_date: TODAY }, TODAY)).toBe('today');
  });

  test('keeps an open task whose day has passed in today, where it can still be seen', () => {
    expect(tabOf({ status: 'unassigned', scheduled_date: '2026-09-09' }, TODAY)).toBe('today');
  });

  test('puts a later day in upcoming', () => {
    expect(tabOf({ status: 'assigned', scheduled_date: '2026-09-12' }, TODAY)).toBe('upcoming');
  });

  test('puts anything closed in closed, whatever its day', () => {
    expect(tabOf({ status: 'done', scheduled_date: '2026-09-12' }, TODAY)).toBe('closed');
    expect(tabOf({ status: 'cancelled', scheduled_date: TODAY }, TODAY)).toBe('closed');
    expect(tabOf({ status: 'expired', scheduled_date: '2026-09-01' }, TODAY)).toBe('closed');
  });
});

describe('tailOf', () => {
  // 10:00 UTC on 23.09: the same calendar day in Prague and in UTC.
  const midMorning = new Date('2026-09-23T10:00:00Z');
  const prague = {
    name: 'Vinohrady 12',
    hostaway_unit_id: null,
    timezone: 'Europe/Prague',
    parent: null,
  };
  const on = (scheduled_date: string, status: Task['status'] = 'assigned') => ({
    status,
    scheduled_date,
    property: prague,
  });

  test("a live cleaning from yesterday is a one-day tail", () => {
    expect(
      tailOf({ status: 'unassigned', scheduled_date: '2026-09-22', property: prague }, midMorning),
    ).toEqual({ days: 1 });
  });

  test('an older live task counts its days', () => {
    expect(
      tailOf({ status: 'assigned', scheduled_date: '2026-09-19', property: prague }, midMorning),
    ).toEqual({ days: 4 });
  });

  test('today and later are not a tail', () => {
    expect(tailOf(on('2026-09-23'), midMorning)).toBeNull();
    expect(tailOf(on('2026-09-24'), midMorning)).toBeNull();
  });

  test('a closed task from yesterday is not a tail', () => {
    expect(tailOf(on('2026-09-22', 'done'), midMorning)).toBeNull();
    expect(tailOf(on('2026-09-22', 'expired'), midMorning)).toBeNull();
  });

  test("the property's own today decides, not the browser's", () => {
    // 22:30 UTC on 23.09 is already the 24th in Prague, still the 23rd in UTC.
    const lateEvening = new Date('2026-09-23T22:30:00Z');
    const utc = { ...prague, timezone: 'UTC' };

    expect(
      tailOf({ status: 'assigned', scheduled_date: '2026-09-23', property: prague }, lateEvening),
    ).toEqual({ days: 1 });
    expect(
      tailOf({ status: 'assigned', scheduled_date: '2026-09-23', property: utc }, lateEvening),
    ).toBeNull();
  });
});

describe('timeGroup', () => {
  test('reads the hour of the window', () => {
    expect(timeGroup({ time_from: '08:30:00' })).toBe('morning');
    expect(timeGroup({ time_from: '12:00:00' })).toBe('afternoon');
    expect(timeGroup({ time_from: '16:59:00' })).toBe('afternoon');
    expect(timeGroup({ time_from: '17:00:00' })).toBe('evening');
  });

  test('a task with no window belongs to no part of the day', () => {
    expect(timeGroup({ time_from: null })).toBe('anytime');
  });
});

describe('groupTasks', () => {
  // Mid-morning of TODAY everywhere between UTC-10 and UTC+13.
  const ON_TODAY = new Date(`${TODAY}T10:00:00Z`);

  test('groups today by the part of the day, earliest first, and drops empty parts', () => {
    const groups = groupTasks(
      [
        task({ id: id(1), time_from: '18:00:00' }),
        task({ id: id(2), time_from: null }),
        task({ id: id(3), time_from: '09:00:00' }),
        task({ id: id(4), time_from: '08:00:00' }),
      ],
      'today',
      ON_TODAY,
    );

    expect(groups.map((group) => group.key)).toEqual(['morning', 'evening', 'anytime']);
    expect(groups[0]?.tasks.map((entry) => entry.time_from)).toEqual(['08:00:00', '09:00:00']);
  });

  test('today puts the tails first, in a group of their own, the oldest day first', () => {
    // Arrange: two live tasks left over from earlier days among today's work.
    const groups = groupTasks(
      [
        task({ id: id(1), time_from: '08:00:00' }),
        task({ id: id(2), scheduled_date: '2026-09-10', time_from: '18:00:00' }),
        task({ id: id(3), time_from: '18:00:00' }),
        task({ id: id(4), scheduled_date: '2026-09-09', time_from: null }),
      ],
      'today',
      ON_TODAY,
    );

    // Act & Assert: the tails no longer hide in the morning and the evening.
    expect(groups.map((group) => group.key)).toEqual(['tail', 'morning', 'evening']);
    expect(groups[0]?.kind).toBe('tail');
    expect(groups[0]?.tasks.map((entry) => entry.id)).toEqual([id(4), id(2)]);
    expect(groups.slice(1).flatMap((group) => group.tasks.map((entry) => entry.id))).toEqual([
      id(1),
      id(3),
    ]);
  });

  test("a tail is counted by the property's own day, as the card's border is", () => {
    // 22:30 UTC is already tomorrow in Prague and still today in UTC.
    const lateEvening = new Date(`${TODAY}T22:30:00Z`);
    const house = (timezone: string) => ({
      name: timezone,
      hostaway_unit_id: null,
      timezone,
      parent: null,
    });

    const groups = groupTasks(
      [
        task({ id: id(1), property: house('Europe/Prague') }),
        task({ id: id(2), property: house('UTC') }),
      ],
      'today',
      lateEvening,
    );

    expect(groups.map((group) => group.key)).toEqual(['tail', 'anytime']);
    expect(groups[0]?.tasks.map((entry) => entry.id)).toEqual([id(1)]);
  });

  test('groups the days ahead by day, nearest first', () => {
    const groups = groupTasks(
      [
        task({ id: id(1), scheduled_date: '2026-09-14' }),
        task({ id: id(2), scheduled_date: '2026-09-12' }),
      ],
      'upcoming',
      ON_TODAY,
    );

    expect(groups.map((group) => group.key)).toEqual(['2026-09-12', '2026-09-14']);
    expect(groups.every((group) => group.kind === 'day')).toBe(true);
  });

  test('groups what is behind us most recent first', () => {
    const groups = groupTasks(
      [
        task({ id: id(1), status: 'done', scheduled_date: '2026-09-08' }),
        task({ id: id(2), status: 'done', scheduled_date: '2026-09-10' }),
      ],
      'closed',
      ON_TODAY,
    );

    expect(groups.map((group) => group.key)).toEqual(['2026-09-10', '2026-09-08']);
  });

  test('at the same hour the rooms of one house stay together', () => {
    // Arrange: two rooms of one building and a flat of another, all at ten.
    // Sorted by the row's own name — "1 - 2109", "3 - 3008" — the other house
    // would land between them.
    const royal = (room: string, unit: number) => ({
      name: room,
      hostaway_unit_id: unit,
      parent: { name: 'CZ - Vinohradska Royal' },
    });
    const groups = groupTasks(
      [
        task({ id: id(1), time_from: '10:00:00', property: royal('3 - 3008', 18009) }),
        task({
          id: id(2),
          time_from: '10:00:00',
          property: { name: '2 - Anglicka', hostaway_unit_id: null, parent: null },
        }),
        task({ id: id(3), time_from: '10:00:00', property: royal('1 - 2109', 18007) }),
      ],
      'today',
      ON_TODAY,
    );

    // Act & Assert
    expect(groups[0]?.tasks.map((entry) => entry.id)).toEqual([id(2), id(3), id(1)]);
  });

  test('a task with no window closes its day', () => {
    const groups = groupTasks(
      [
        task({ id: id(1), scheduled_date: '2026-09-12', time_from: null }),
        task({ id: id(2), scheduled_date: '2026-09-12', time_from: '10:00:00' }),
      ],
      'upcoming',
      ON_TODAY,
    );

    expect(groups[0]?.tasks.map((entry) => entry.id)).toEqual([id(2), id(1)]);
  });
});

describe('matchesFilters', () => {
  const maria = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
  const cleaning = task({
    id: id(1),
    title: 'Генеральная уборка',
    assignee_id: maria,
    property: { name: 'Vinohrady 12', hostaway_unit_id: null, parent: null },
    assignee: { full_name: 'Maria Test', role: 'cleaner' },
  });
  const inspection = task({ id: id(2), type: 'inspection', title: 'Осмотр' });

  test('an empty filter keeps everything', () => {
    expect(matchesFilters(cleaning, EMPTY_FILTERS)).toBe(true);
  });

  test('the query reads the title, the listing and the person', () => {
    const filters = EMPTY_FILTERS;
    expect(matchesFilters(cleaning, { ...filters, query: 'генеральная' })).toBe(true);
    expect(matchesFilters(cleaning, { ...filters, query: 'vinohrady' })).toBe(true);
    expect(matchesFilters(cleaning, { ...filters, query: 'maria' })).toBe(true);
    expect(matchesFilters(cleaning, { ...filters, query: 'karlín' })).toBe(false);
  });

  test('nobody keeps only the work still in the queue', () => {
    expect(matchesFilters(cleaning, { ...EMPTY_FILTERS, assigneeId: 'nobody' })).toBe(false);
    expect(matchesFilters(inspection, { ...EMPTY_FILTERS, assigneeId: 'nobody' })).toBe(true);
  });

  test('a person keeps only their own work', () => {
    expect(matchesFilters(cleaning, { ...EMPTY_FILTERS, assigneeId: maria })).toBe(true);
    expect(matchesFilters(inspection, { ...EMPTY_FILTERS, assigneeId: maria })).toBe(false);
  });

  test('the dates are inclusive at both ends, and either end may be left open', () => {
    const onTheDay = task({ id: id(3), scheduled_date: '2026-09-11' });
    const later = task({ id: id(4), scheduled_date: '2026-09-14' });

    expect(matchesFilters(onTheDay, { ...EMPTY_FILTERS, dateFrom: '2026-09-11' })).toBe(true);
    expect(matchesFilters(onTheDay, { ...EMPTY_FILTERS, dateTo: '2026-09-11' })).toBe(true);
    expect(matchesFilters(onTheDay, { ...EMPTY_FILTERS, dateFrom: '2026-09-12' })).toBe(false);
    expect(matchesFilters(later, { ...EMPTY_FILTERS, dateTo: '2026-09-12' })).toBe(false);
    expect(
      matchesFilters(later, { ...EMPTY_FILTERS, dateFrom: '2026-09-12', dateTo: '2026-09-15' }),
    ).toBe(true);
  });

  test('hasFilters knows whether an empty list means "no work" or "nothing found"', () => {
    expect(hasFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasFilters({ ...EMPTY_FILTERS, dateFrom: '2026-09-11' })).toBe(true);
    expect(hasFilters({ ...EMPTY_FILTERS, query: '  ' })).toBe(false);
    expect(hasFilters({ ...EMPTY_FILTERS, assigneeId: 'nobody' })).toBe(true);
  });

  test('the kind filters by kind', () => {
    expect(matchesFilters(cleaning, { ...EMPTY_FILTERS, type: 'inspection' })).toBe(
      false,
    );
    expect(matchesFilters(inspection, { ...EMPTY_FILTERS, type: 'inspection' })).toBe(
      true,
    );
  });
});

describe('localizedTitle', () => {
  test('reads the translation for the language', () => {
    const entry = { title: 'Генеральная уборка', title_i18n: { cs: 'Hloubkový úklid' } };
    expect(localizedTitle(entry, 'cs')).toBe('Hloubkový úklid');
  });

  test('falls back to the company words when there is no translation', () => {
    const entry = { title: 'Генеральная уборка', title_i18n: { cs: '  ' } };
    expect(localizedTitle(entry, 'cs')).toBe('Генеральная уборка');
    expect(localizedTitle({ title: 'Осмотр', title_i18n: null }, 'en')).toBe('Осмотр');
  });

  test('a generated task has no title of its own', () => {
    expect(localizedTitle({ title: null, title_i18n: null }, 'ru')).toBeNull();
  });
});

describe('taskMinutes', () => {
  test('the correction wins over the measurement', () => {
    expect(taskMinutes({ measured_minutes: 40, duration_override_min: 95 })).toBe(95);
  });

  test('without one, the measurement stands', () => {
    expect(taskMinutes({ measured_minutes: 40, duration_override_min: null })).toBe(40);
    expect(taskMinutes({ measured_minutes: null, duration_override_min: null })).toBeNull();
  });
});

describe('isManualTask', () => {
  test('a task from a booking or a report was not written by hand', () => {
    expect(isManualTask({ reservation_id: 7, problem_id: null })).toBe(false);
    expect(isManualTask({ reservation_id: null, problem_id: id(9) })).toBe(false);
    expect(isManualTask({ reservation_id: null, problem_id: null })).toBe(true);
  });
});

describe('draftFromTask', () => {
  test('carries the task into the form, with the clock cut to hours and minutes', () => {
    const draft = draftFromTask(
      task({
        id: id(1),
        title: 'Генеральная уборка',
        title_i18n: { en: 'Deep clean' },
        time_from: '10:00:00',
        time_to: '12:30:00',
        notes: 'Ключи у соседей',
      }),
    );

    expect(draft).toMatchObject({
      id: id(1),
      title: 'Генеральная уборка',
      timeFrom: '10:00',
      timeTo: '12:30',
      notes: 'Ключи у соседей',
    });
  });
});

describe('isDraftReady', () => {
  const draft = draftFromTask(task({ id: id(1), title: 'Осмотр' }));

  test('a listing and a day are what the panel can check itself', () => {
    expect(isDraftReady(draft)).toBe(true);
    expect(isDraftReady({ ...draft, propertyId: null })).toBe(false);
    // A task without a name is called by its kind, so a blank title is fine.
    expect(isDraftReady({ ...draft, title: '   ' })).toBe(true);
    expect(isDraftReady({ ...draft, scheduledDate: '' })).toBe(false);
  });

  test('an inspection or a maintenance job is not ready without an executor', () => {
    const person = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';

    expect(isDraftReady({ ...draft, type: 'inspection', assigneeId: null })).toBe(false);
    expect(isDraftReady({ ...draft, type: 'maintenance', assigneeId: null })).toBe(false);
    expect(isDraftReady({ ...draft, type: 'inspection', assigneeId: person })).toBe(true);
    expect(isDraftReady({ ...draft, type: 'maintenance', assigneeId: person })).toBe(true);
  });

  test('a cleaning may still wait in the queue for somebody', () => {
    expect(isDraftReady({ ...draft, type: 'cleaning', assigneeId: null })).toBe(true);
    expect(isDraftReady({ ...draft, type: 'midstay', assigneeId: null })).toBe(true);
  });
});

describe('needsAssignee', () => {
  test('only an inspection and a maintenance job must have somebody from the start', () => {
    expect(needsAssignee('inspection')).toBe(true);
    expect(needsAssignee('maintenance')).toBe(true);
    expect(needsAssignee('cleaning')).toBe(false);
    expect(needsAssignee('midstay')).toBe(false);
  });
});

describe('isAssigneeMissing', () => {
  const draft = draftFromTask(task({ id: id(1) }));

  test('is the gap the form points at, and only on the kinds that need somebody', () => {
    expect(isAssigneeMissing({ ...draft, type: 'inspection', assigneeId: null })).toBe(true);
    expect(isAssigneeMissing({ ...draft, type: 'cleaning', assigneeId: null })).toBe(false);
    expect(
      isAssigneeMissing({
        ...draft,
        type: 'maintenance',
        assigneeId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
      }),
    ).toBe(false);
  });
});

describe('propertyOptions', () => {
  const royal = { id: 219524, name: 'CZ - Vinohradska Royal', parent_id: null, hostaway_unit_id: null };
  const first = { id: 1000000018007, name: '1 - 2109', parent_id: 219524, hostaway_unit_id: 18007 };
  const third = { id: 1000000018009, name: '3 - 3008', parent_id: 219524, hostaway_unit_id: 18009 };
  const anglicka = { id: 98352, name: 'Anglicka 7', parent_id: null, hostaway_unit_id: null };

  test('an ordinary listing is named as it always was', () => {
    expect(propertyOptions([anglicka])).toEqual([{ id: 98352, name: 'Anglicka 7' }]);
  });

  test('a room is named by the building it is in, because its own name never says', () => {
    const options = propertyOptions([royal, first]);

    expect(options).toContainEqual({
      id: 1000000018007,
      name: 'CZ - Vinohradska Royal — 1 - 2109',
    });
  });

  test('rooms follow their own listing, and the listings stay alphabetical', () => {
    const options = propertyOptions([third, anglicka, first, royal]);

    expect(options.map((option) => option.name)).toEqual([
      'Anglicka 7',
      'CZ - Vinohradska Royal',
      'CZ - Vinohradska Royal — 1 - 2109',
      'CZ - Vinohradska Royal — 3 - 3008',
    ]);
  });

  test('a room whose listing is not in the list is still offered, under its own name', () => {
    // Not expected to happen — the status cascade takes rooms with their
    // listing — but a room dropped here is a task whose flat field goes blank,
    // which is the very defect this list exists to prevent.
    expect(propertyOptions([first])).toEqual([{ id: 1000000018007, name: '1 - 2109' }]);
  });

  test('the listing itself stays pickable: a repair in the hallway belongs to the building', () => {
    expect(propertyOptions([royal, first]).map((option) => option.id)).toContain(219524);
  });
});

describe('taskPropertyName', () => {
  const onListing = task({
    id: id(1),
    property: { name: 'Anglicka 7', hostaway_unit_id: null, parent: null },
  });
  const inRoom = task({
    id: id(2),
    property: {
      name: '1 - 2109',
      hostaway_unit_id: 18007,
      parent: { name: 'CZ - Vinohradska Royal' },
    },
  });

  test('a cleaning of an ordinary listing is named as it always was', () => {
    expect(taskPropertyName(onListing)).toBe('Anglicka 7');
  });

  test('a cleaning of a room is named by its building and itself', () => {
    expect(taskPropertyName(inRoom)).toBe('CZ - Vinohradska Royal — 1 - 2109');
  });

  test('a part of a combined listing keeps its own name, parent or no parent', () => {
    // `parent_id` carries two relationships, and only one of them is a room.
    // A part of a combined listing is a listing with its own calendar and its
    // own guests; naming it after its neighbour would be plainly wrong.
    const part = task({
      id: id(4),
      property: { name: 'Žitná 12 ap. 313', hostaway_unit_id: null, parent: { name: 'Žitná 12' } },
    });

    expect(taskPropertyName(part)).toBe('Žitná 12 ap. 313');
  });

  test('a task whose listing was not joined has no name to show', () => {
    expect(taskPropertyName(task({ id: id(3) }))).toBeNull();
  });
});

describe('the search finds a room cleaning by the house it is in', () => {
  const inRoom = task({
    id: id(1),
    property: {
      name: '1 - 2109',
      hostaway_unit_id: 18007,
      parent: { name: 'CZ - Vinohradska Royal' },
    },
  });

  test('the name of the building matches, though the task carries the room', () => {
    // The defect this is here for: the cleanings of nine listings moved onto
    // rooms, and a manager searching the house they all belong to found none
    // of them — the row says "1 - 2109" and nothing else.
    expect(matchesQuery(inRoom, 'vinohradska')).toBe(true);
  });

  test('and the room itself still matches', () => {
    expect(matchesQuery(inRoom, '2109')).toBe(true);
  });

  test('the house and the room together match, in either order', () => {
    // What a manager types after reading the card: two words that are nowhere
    // next to each other in the row, and only a token search can join them.
    expect(matchesQuery(inRoom, 'vinohradska 2109')).toBe(true);
    expect(matchesQuery(inRoom, '2109 vinohradska')).toBe(true);
  });

  test('a house it is not in does not match', () => {
    expect(matchesQuery(inRoom, 'anglicka')).toBe(false);
  });

  test('a word that is nowhere in the task still excludes it', () => {
    expect(matchesQuery(inRoom, 'vinohradska karlín')).toBe(false);
  });

  test('the filter bar asks the same question', () => {
    expect(matchesFilters(inRoom, { ...EMPTY_FILTERS, query: 'vinohradska' })).toBe(true);
  });
});

describe('the search ignores diacritics', () => {
  test('finds the work of a person whose name is typed without its marks', () => {
    const hers = task({
      id: id(1),
      assignee_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
      assignee: { full_name: 'Šárka Nováková', role: 'cleaner' },
    });

    expect(matchesQuery(hers, 'sarka')).toBe(true);
    expect(matchesQuery(hers, 'novakova sarka')).toBe(true);
  });
});
