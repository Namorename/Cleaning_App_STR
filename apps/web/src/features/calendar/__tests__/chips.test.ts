import { describe, expect, test } from 'vitest';

import { calendarTaskSchema, type CalendarTask } from '@/features/tasks/schema';
import { buildPropertyTree } from '@/lib/property-tree';

import {
  cellTasks,
  chipCapacity,
  chipTone,
  isBookingChanged,
  matchesChipFilters,
  offListAssignees,
  tasksByRowDay,
} from '../chips';
import type { CalendarBooking } from '../schema';

/**
 * The rules of the task chips (docs/f10-plan.md, 7.4, §2, §4).
 */

let serial = 0;
function task(property: number, day: string, extra: Record<string, unknown> = {}): CalendarTask {
  serial += 1;
  return calendarTaskSchema.parse({
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
    property_id: property,
    reservation_id: null,
    problem_id: null,
    type: 'cleaning',
    status: 'assigned',
    priority: 0,
    assignee_id: null,
    scheduled_date: day,
    time_from: null,
    time_to: null,
    started_at: null,
    completed_at: null,
    measured_minutes: null,
    duration_override_min: null,
    notes: null,
    created_at: '2026-09-20T08:00:00+00:00',
    problem: null,
    ...extra,
  });
}

function booking(
  id: number,
  departure: string,
  extra: Partial<CalendarBooking> = {},
): CalendarBooking {
  return {
    id,
    property_id: 1,
    arrival_date: '2026-09-20',
    departure_date: departure,
    status: 'new',
    is_block: false,
    guest_name: `Guest ${id}`,
    guests_count: 2,
    check_in_time: null,
    check_out_time: null,
    rooms: [],
    is_service_booking: false,
    ...extra,
  };
}

const ANNA = '11111111-1111-4111-8111-111111111111';
const IVA = '22222222-2222-4222-8222-222222222222';

describe('the colour of a chip', () => {
  test('follows the status filter: open, in work, done', () => {
    expect(
      ['unassigned', 'assigned', 'accepted'].map((status) => chipTone(status as never)),
    ).toEqual(['open', 'open', 'open']);
    expect(['in_progress', 'paused', 'blocked'].map((status) => chipTone(status as never))).toEqual(
      ['inWork', 'inWork', 'inWork'],
    );
    expect(chipTone('done')).toBe('done');
  });
});

describe('the filters', () => {
  const open = task(1, '2026-09-28', { status: 'unassigned' });
  const working = task(1, '2026-09-28', { status: 'in_progress', assignee_id: ANNA });
  const done = task(1, '2026-09-28', { status: 'done', assignee_id: IVA });

  test('“Все” keeps every chip; each group keeps its own statuses', () => {
    const kept = (status: 'all' | 'open' | 'inWork' | 'done') =>
      [open, working, done].filter((one) => matchesChipFilters(one, status, 'all'));

    expect(kept('all')).toEqual([open, working, done]);
    expect(kept('open')).toEqual([open]);
    expect(kept('inWork')).toEqual([working]);
    expect(kept('done')).toEqual([done]);
  });

  test('the assignee filter keeps nobody’s, or one person’s', () => {
    const kept = (assignee: string) =>
      [open, working, done].filter((one) => matchesChipFilters(one, 'all', assignee));

    expect(kept('nobody')).toEqual([open]);
    expect(kept(ANNA)).toEqual([working]);
  });
});

// A cleaning taken or started is not moved by the generator when its booking
// moves or goes (§2): the chip then warns.
describe('a booking that changed under a live chip', () => {
  const bookings = new Map([[5, booking(5, '2026-09-28')]]);

  test('is not judged before the bookings are read', () => {
    expect(
      isBookingChanged(task(1, '2026-09-28', { status: 'accepted', reservation_id: 9 }), null),
    ).toBe(false);
  });

  test('a booking that is gone, or leaves on another day, is a change', () => {
    expect(
      isBookingChanged(task(1, '2026-09-28', { status: 'accepted', reservation_id: 9 }), bookings),
    ).toBe(true);
    expect(
      isBookingChanged(
        task(1, '2026-09-29', { status: 'in_progress', reservation_id: 5 }),
        bookings,
      ),
    ).toBe(true);
  });

  test('the booking that still leaves on the chip’s day is no change', () => {
    expect(
      isBookingChanged(task(1, '2026-09-28', { status: 'accepted', reservation_id: 5 }), bookings),
    ).toBe(false);
  });

  // The generator still moves and cancels these: a mismatch is its lag, or a
  // bookings layer older than the tasks just reread after a save.
  test('a cleaning nobody has taken yet is never judged', () => {
    for (const status of ['unassigned', 'assigned']) {
      expect(isBookingChanged(task(1, '2026-09-28', { status, reservation_id: 9 }), bookings)).toBe(
        false,
      );
    }
  });

  test('a booking that became a block or the office’s own "#" booking is a change', () => {
    const blocks = new Map([
      [6, booking(6, '2026-09-28', { status: 'ownerStay' })],
      [7, booking(7, '2026-09-28', { is_block: true })],
      [8, booking(8, '2026-09-28', { is_service_booking: true })],
    ]);

    for (const id of [6, 7, 8]) {
      expect(
        isBookingChanged(task(1, '2026-09-28', { status: 'accepted', reservation_id: id }), blocks),
      ).toBe(true);
    }
  });

  test('a booking moved to another listing is a change; its listing and its rooms are not', () => {
    const rooms = new Map([
      [5, booking(5, '2026-09-28', { property_id: 10, rooms: [{ property_id: 11 }] })],
    ]);
    const at = (property: number) =>
      isBookingChanged(
        task(property, '2026-09-28', { status: 'accepted', reservation_id: 5 }),
        rooms,
      );

    expect(at(2)).toBe(true);
    expect(at(11)).toBe(false);
    // A cleaning from before 12.09 still stands on the listing of a booking of rooms.
    expect(at(10)).toBe(false);
  });

  // A mid-stay cleaning stands inside its stay, not on the departure.
  test('only a departure cleaning is judged by its departure', () => {
    expect(
      isBookingChanged(
        task(1, '2026-09-25', { type: 'midstay', status: 'accepted', reservation_id: 5 }),
        bookings,
      ),
    ).toBe(false);
  });

  test('a task written by hand and a done one are never judged', () => {
    expect(isBookingChanged(task(1, '2026-09-28', { status: 'accepted' }), bookings)).toBe(false);
    expect(
      isBookingChanged(task(1, '2026-09-28', { status: 'done', reservation_id: 9 }), bookings),
    ).toBe(false);
  });
});

describe('the chips of a cell', () => {
  const tree = buildPropertyTree([
    { id: 10, name: 'Royal Cerna', parent_id: null, hostaway_unit_id: null },
    { id: 11, name: 'Unit 1', parent_id: 10, hostaway_unit_id: 7001 },
    { id: 12, name: 'Unit 2', parent_id: 10, hostaway_unit_id: 7002 },
  ]);
  const late = task(11, '2026-09-28', { time_from: '14:00:00' });
  const early = task(12, '2026-09-28', { time_from: '10:00:00' });
  const loose = task(11, '2026-09-28');
  const own = task(10, '2026-09-28', { time_from: '12:00:00' });
  const byRowDay = tasksByRowDay([late, early, loose, own]);

  test('a room shows its own, earliest window first, no window last', () => {
    expect(cellTasks(tree[0].children[0], '2026-09-28', byRowDay, false)).toEqual([late, loose]);
  });

  test('an open group’s listing shows its own only', () => {
    expect(cellTasks(tree[0], '2026-09-28', byRowDay, false)).toEqual([own]);
  });

  test('a closed group folds its rooms’ chips into its row', () => {
    expect(cellTasks(tree[0], '2026-09-28', byRowDay, true)).toEqual([early, own, late, loose]);
  });
});

describe('how many chips a cell has room for', () => {
  test('a week reads a chip in full; wider columns take more', () => {
    expect(chipCapacity(130)).toEqual({ mode: 'full', count: 1 });
    expect(chipCapacity(200)).toEqual({ mode: 'full', count: 1 });
    expect(chipCapacity(320)).toEqual({ mode: 'full', count: 2 });
  });

  test('fifteen and thirty days show up to two dots', () => {
    expect(chipCapacity(64)).toEqual({ mode: 'dot', count: 2 });
    expect(chipCapacity(32)).toEqual({ mode: 'dot', count: 2 });
  });
});

describe('the assignee filter’s list', () => {
  test('names people on the chips who are no longer among the active staff, once each', () => {
    const tasks = [
      task(1, '2026-09-28', {
        assignee_id: ANNA,
        assignee: { full_name: 'Anna', role: 'cleaner' },
      }),
      task(1, '2026-09-29', { assignee_id: IVA, assignee: { full_name: 'Iva', role: 'cleaner' } }),
      task(1, '2026-09-30', { assignee_id: IVA, assignee: { full_name: 'Iva', role: 'cleaner' } }),
      task(1, '2026-09-30'),
    ];

    expect(offListAssignees(tasks, [{ id: ANNA, full_name: 'Anna', role: 'cleaner' }])).toEqual([
      { id: IVA, name: 'Iva' },
    ]);
  });
});
