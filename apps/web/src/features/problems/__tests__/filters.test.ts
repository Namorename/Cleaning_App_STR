import { describe, expect, test } from 'vitest';

import {
  assigneeOptions,
  EMPTY_PROBLEM_FILTERS,
  hasProblemFilters,
  knownFilters,
  matchesProblemFilters,
  NO_PLACE,
  placeOptions,
  type ProblemFilters,
} from '../filters';
import { problemSchema, type Problem } from '../schema';

const PETR = '55555555-5555-4555-8555-555555555555';
const IVAN = '66666666-6666-4666-8666-666666666666';

let next = 0;

/** A task as the panel reads it; each gets an id of its own. */
function task(overrides: Record<string, unknown> = {}): Problem {
  next += 1;
  return problemSchema.parse({
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    property_id: 1,
    task_id: null,
    reported_by: '22222222-2222-4222-8222-222222222222',
    title: 'Течёт кран',
    description: null,
    priority: 'normal',
    status: 'open',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-10-05T10:00:00+00:00',
    property: { name: 'Karlín 3' },
    fix_tasks: [],
    ...overrides,
  });
}

/** A repair of the task, held by `assigneeId`. */
function repair(assigneeId: string | null, status: string, name: string | null = 'Petr Fixer') {
  next += 1;
  return {
    id: `99999999-0000-4000-8000-${String(next).padStart(12, '0')}`,
    assignee_id: assigneeId,
    status,
    scheduled_date: '2026-10-06',
    time_from: null,
    time_to: null,
    assignee: { full_name: name },
  };
}

// A house of rooms, as Hostaway books it: the cleaning (and a report filed
// from it) stands on the room, whose own name names no house.
const ROYAL = 'CZ - Royal';
const room = (name: string) => ({ name, hostaway_unit_id: 7, parent: { name: ROYAL } });

const filters = (patch: Partial<ProblemFilters>): ProblemFilters => ({
  ...EMPTY_PROBLEM_FILTERS,
  ...patch,
});
const place = (name: string) => ({ kind: 'place' as const, name });

describe('the filters of «Задания»', () => {
  test('none set keeps every task', () => {
    const tasks = [task(), task({ property_id: null, property: null })];

    expect(tasks.filter((one) => matchesProblemFilters(one, EMPTY_PROBLEM_FILTERS))).toEqual(tasks);
    expect(hasProblemFilters(EMPTY_PROBLEM_FILTERS)).toBe(false);
  });

  test('each filter alone counts as set', () => {
    expect(hasProblemFilters(filters({ query: 'кран' }))).toBe(true);
    expect(hasProblemFilters(filters({ query: '   ' }))).toBe(false);
    expect(hasProblemFilters(filters({ place: NO_PLACE }))).toBe(true);
    expect(hasProblemFilters(filters({ place: place('Karlín 3') }))).toBe(true);
    expect(hasProblemFilters(filters({ assigneeId: 'nobody' }))).toBe(true);
    expect(hasProblemFilters(filters({ dateFrom: '2026-10-01' }))).toBe(true);
    expect(hasProblemFilters(filters({ dateTo: '2026-10-01' }))).toBe(true);
  });

  describe('the listing', () => {
    const onHouse = task({ property: { name: ROYAL } });
    const in2109 = task({ property: room('1 - 2109') });
    const in2110 = task({ property: room('1 - 2110') });
    const elsewhere = task({ property: { name: 'Karlín 3' } });
    const nowhere = task({ property_id: null, property: null });
    const all = [onHouse, in2109, in2110, elsewhere, nowhere];
    const kept = (chosen: ProblemFilters) =>
      all.filter((one) => matchesProblemFilters(one, chosen));

    test('a room is matched by the place its card shows, and by nothing else', () => {
      expect(kept(filters({ place: place(`${ROYAL} — 1 - 2109`) }))).toEqual([in2109]);
    });

    test('a house matches its own tasks and those of every room in it', () => {
      expect(kept(filters({ place: place(ROYAL) }))).toEqual([onHouse, in2109, in2110]);
    });

    // A part of a combined listing has its own calendar and guests: its card
    // names it alone, and its villa does not take it along (property-tree.ts).
    test('a part of a combined listing is a listing of its own', () => {
      const part = task({
        property: { name: 'Villa A', hostaway_unit_id: null, parent: { name: 'Villa' } },
      });
      const villa = task({ property: { name: 'Villa' } });

      expect(
        [part, villa].filter((one) =>
          matchesProblemFilters(one, filters({ place: place('Villa') })),
        ),
      ).toEqual([villa]);
      expect(
        [part, villa].filter((one) =>
          matchesProblemFilters(one, filters({ place: place('Villa A') })),
        ),
      ).toEqual([part]);
    });

    test('«Без объекта» keeps only the tasks with no listing', () => {
      expect(kept(filters({ place: NO_PLACE }))).toEqual([nowhere]);
    });
  });

  describe('the assignee', () => {
    const waiting = task({ status: 'open' });
    const takenOff = task({ status: 'open', fix_tasks: [repair(PETR, 'cancelled')] });
    const petrs = task({ status: 'assigned', fix_tasks: [repair(PETR, 'assigned')] });
    const ivans = task({ status: 'in_progress', fix_tasks: [repair(IVAN, 'in_progress', 'Ivan')] });
    const fixedByPetr = task({ status: 'resolved', fix_tasks: [repair(PETR, 'done')] });
    const called = task({ status: 'cancelled' });
    const all = [waiting, takenOff, petrs, ivans, fixedByPetr, called];
    const kept = (assigneeId: string) =>
      all.filter((one) => matchesProblemFilters(one, filters({ assigneeId })));

    // The person the card shows: the one on the live repair (liveFixTask).
    test('a person matches the tasks whose live repair they hold', () => {
      expect(kept(PETR)).toEqual([petrs]);
      expect(kept(IVAN)).toEqual([ivans]);
    });

    // As the head technician's board on the phone has it: a closed task waits
    // for nobody (apps/mobile/src/features/board/schema.ts).
    test('«Не назначено» keeps the live tasks nobody holds', () => {
      expect(kept('nobody')).toEqual([waiting, takenOff]);
    });
  });

  describe('the day it was reported', () => {
    const first = task({ created_at: '2026-10-01T08:00:00+00:00' });
    const fifth = task({ created_at: '2026-10-05T08:00:00+00:00' });
    const ninth = task({ created_at: '2026-10-09T08:00:00+00:00' });
    const all = [first, fifth, ninth];
    const kept = (dateFrom: string, dateTo: string) =>
      all.filter((one) => matchesProblemFilters(one, filters({ dateFrom, dateTo })));

    test('takes both ends of the range in', () => {
      expect(kept('2026-10-01', '2026-10-05')).toEqual([first, fifth]);
      expect(kept('2026-10-05', '2026-10-05')).toEqual([fifth]);
    });

    test('an end left empty is open', () => {
      expect(kept('2026-10-05', '')).toEqual([fifth, ninth]);
      expect(kept('', '2026-10-04')).toEqual([first]);
    });

    // Half past midnight in Prague is still the evening before in UTC.
    test('counts the day in the company’s zone, Prague', () => {
      const pastMidnight = task({ created_at: '2026-09-30T22:30:00+00:00' });

      expect(
        matchesProblemFilters(
          pastMidnight,
          filters({ dateFrom: '2026-10-01', dateTo: '2026-10-01' }),
        ),
      ).toBe(true);
      expect(matchesProblemFilters(pastMidnight, filters({ dateTo: '2026-09-30' }))).toBe(false);
    });
  });

  test('every filter set has to hold, the search among them', () => {
    const fields = {
      title: 'Сломан замок',
      property: room('1 - 2109'),
      status: 'assigned',
      fix_tasks: [repair(PETR, 'assigned')],
      created_at: '2026-10-03T10:00:00+00:00',
    };
    const match = task(fields);
    const otherDay = task({ ...fields, created_at: '2026-10-08T10:00:00+00:00' });
    const otherPerson = task({ ...fields, fix_tasks: [repair(IVAN, 'assigned', 'Ivan')] });
    const otherWords = task({ ...fields, title: 'Течёт кран' });
    const otherPlace = task({ ...fields, property: { name: 'Karlín 3' } });
    const chosen = filters({
      query: 'замок',
      place: place(ROYAL),
      assigneeId: PETR,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-05',
    });

    expect(
      [match, otherDay, otherPerson, otherWords, otherPlace].filter((one) =>
        matchesProblemFilters(one, chosen),
      ),
    ).toEqual([match]);
  });
});

describe('what the filters offer', () => {
  // Each house once, followed by the rooms that have a task, as the cards
  // name them: the house is offered even when only its rooms have tasks.
  test('every place with a task, each house followed by its rooms, in the order a person counts', () => {
    const tasks = [
      task({ property: room('1 - 2110') }),
      task({ property: { name: 'Unit 10' } }),
      task({ property: room('1 - 2109') }),
      task({ property: { name: 'Unit 3' } }),
      task({ property: room('1 - 2109') }),
      task({ property_id: null, property: null }),
    ];

    expect(placeOptions(tasks)).toEqual([
      { name: ROYAL, isRoom: false },
      { name: `${ROYAL} — 1 - 2109`, isRoom: true },
      { name: `${ROYAL} — 1 - 2110`, isRoom: true },
      { name: 'Unit 3', isRoom: false },
      { name: 'Unit 10', isRoom: false },
    ]);
  });

  test('the people on a live repair, once each, by name', () => {
    const tasks = [
      task({ fix_tasks: [repair(PETR, 'assigned', 'Petr Fixer')] }),
      task({ fix_tasks: [repair(IVAN, 'in_progress', 'Ivan Opravář')] }),
      task({ fix_tasks: [repair(PETR, 'assigned', 'Petr Fixer')] }),
      task({ fix_tasks: [repair(null, 'assigned', null)] }),
    ];

    expect(assigneeOptions(tasks, 'all')).toEqual([
      { id: IVAN, name: 'Ivan Opravář' },
      { id: PETR, name: 'Petr Fixer' },
    ]);
  });

  // Filtered by Petr, the manager closes Petr's last repair: the filter must
  // not let go of him, or the whole board would come back unasked.
  test('the person chosen stays on offer while any repair still names him', () => {
    const tasks = [task({ status: 'resolved', fix_tasks: [repair(PETR, 'done', 'Petr Fixer')] })];

    expect(assigneeOptions(tasks, 'all')).toEqual([]);
    expect(assigneeOptions(tasks, PETR)).toEqual([{ id: PETR, name: 'Petr Fixer' }]);
  });

  // An old link or a hand-edited one: what no task names is set aside, the
  // rest of the filters stand.
  test('a place or a person no task names is set aside, the rest stays', () => {
    const tasks = [task({ property: { name: 'Karlín 3' }, fix_tasks: [repair(PETR, 'assigned')] })];
    const asked = filters({
      query: 'кран',
      place: place('Nowhere 1'),
      assigneeId: IVAN,
      dateFrom: '2026-10-01',
    });

    expect(knownFilters(asked, placeOptions(tasks), assigneeOptions(tasks, IVAN))).toEqual(
      filters({ query: 'кран', dateFrom: '2026-10-01' }),
    );
    const fine = filters({ place: place('Karlín 3'), assigneeId: PETR });
    expect(knownFilters(fine, placeOptions(tasks), assigneeOptions(tasks, PETR))).toEqual(fine);
    const special = filters({ place: NO_PLACE, assigneeId: 'nobody' });
    expect(knownFilters(special, [], [])).toEqual(special);
  });
});
