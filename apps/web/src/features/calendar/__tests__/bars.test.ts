import { describe, expect, test } from 'vitest';

import { buildPropertyTree } from '@/lib/property-tree';

import { barKind, layoutRows, mergeBookings, spanOf } from '../bars';
import { windowDays } from '../dates';
import type { CalendarBooking } from '../schema';

/**
 * Where a booking is drawn (docs/f10-plan.md, 7.3). Positions are in days
 * from the window's first day, so a column's width never enters the rules.
 */

const DAYS = windowDays('2026-09-25', 7); // 25 September to 1 October

function booking(
  id: number,
  property: number,
  arrival: string,
  departure: string,
  extra: Partial<CalendarBooking> = {},
): CalendarBooking {
  return {
    id,
    property_id: property,
    arrival_date: arrival,
    departure_date: departure,
    status: 'new',
    is_block: false,
    guest_name: `Guest ${id}`,
    guests_count: 2,
    check_in_time: '15:00:00',
    check_out_time: '10:00:00',
    rooms: [],
    is_service_booking: false,
    ...extra,
  };
}

const row = (
  id: number,
  name: string,
  parent: number | null = null,
  unit: number | null = null,
) => ({
  id,
  name,
  parent_id: parent,
  hostaway_unit_id: unit,
});

const TREE = buildPropertyTree([
  row(1, 'Anglicka 7'),
  row(10, 'Royal Cerna'),
  row(11, 'Unit 1', 10, 7001),
  row(12, 'Unit 2', 10, 7002),
  row(20, 'Villa Whole'),
  row(21, 'Villa East', 20),
  row(22, 'Villa West', 20),
]);

describe('a bar', () => {
  test('runs from the middle of the arrival day to the middle of the departure day', () => {
    expect(spanOf('2026-09-26', '2026-09-28', DAYS)).toEqual({
      from: 1.5,
      to: 3.5,
      cutStart: false,
      cutEnd: false,
    });
  });

  test('a changeover shares one cell: the stay that leaves and the one that comes', () => {
    const leaving = spanOf('2026-09-25', '2026-09-28', DAYS);
    const coming = spanOf('2026-09-28', '2026-09-30', DAYS);

    expect(leaving?.to).toBe(3.5);
    expect(coming?.from).toBe(3.5);
  });

  test('a 99-night stay is cut at both edges of the window and says so', () => {
    expect(spanOf('2026-08-17', '2026-11-24', DAYS)).toEqual({
      from: 0,
      to: 7,
      cutStart: true,
      cutEnd: true,
    });
  });

  test('a departure on the first day is half a cell, cut at the start', () => {
    expect(spanOf('2026-09-20', '2026-09-25', DAYS)).toEqual({
      from: 0,
      to: 0.5,
      cutStart: true,
      cutEnd: false,
    });
  });

  test('a stay the window does not touch is not drawn', () => {
    expect(spanOf('2026-09-20', '2026-09-24', DAYS)).toBeNull();
    expect(spanOf('2026-10-02', '2026-10-05', DAYS)).toBeNull();
  });
});

describe('what a bar says', () => {
  test('a guest is a guest; an owner stay, a Hostaway block and a "#" booking are blocks', () => {
    expect(barKind(booking(1, 1, '2026-09-26', '2026-09-28'))).toBe('guest');
    expect(barKind(booking(2, 1, '2026-09-26', '2026-09-28', { status: 'modified' }))).toBe(
      'guest',
    );
    expect(barKind(booking(3, 1, '2026-09-26', '2026-09-28', { status: 'ownerStay' }))).toBe(
      'block',
    );
    expect(barKind(booking(4, 1, '2026-09-26', '2026-09-28', { is_block: true }))).toBe('block');
    expect(
      barKind(
        booking(5, 1, '2026-09-26', '2026-09-28', {
          guest_name: '#Boiler - repair',
          is_service_booking: true,
        }),
      ),
    ).toBe('block');
  });
});

describe('the rows a booking lands on', () => {
  test('a booking of rooms is drawn on each room, not on the listing', () => {
    const layout = layoutRows(
      TREE,
      [
        booking(1, 10, '2026-09-26', '2026-09-28', {
          rooms: [{ property_id: 11 }, { property_id: 12 }],
        }),
      ],
      DAYS,
    );

    expect(layout.get(11)?.bars.map((bar) => bar.booking.id)).toEqual([1]);
    expect(layout.get(12)?.bars.map((bar) => bar.booking.id)).toEqual([1]);
    expect(layout.get(10)?.bars).toEqual([]);
  });

  test('a booking that names no room stays on its listing', () => {
    const layout = layoutRows(TREE, [booking(1, 10, '2026-09-26', '2026-09-28')], DAYS);

    expect(layout.get(10)?.bars.map((bar) => bar.booking.id)).toEqual([1]);
  });
});

describe('a double booking', () => {
  test('overlapping stays share the track in halves, and a third one apart keeps it whole', () => {
    const layout = layoutRows(
      TREE,
      [
        booking(1, 1, '2026-09-25', '2026-09-28'),
        booking(2, 1, '2026-09-27', '2026-09-29'),
        booking(3, 1, '2026-09-29', '2026-10-01'),
      ],
      DAYS,
    );
    const bars = layout.get(1)?.bars ?? [];
    const of = (id: number) => bars.find((bar) => bar.booking.id === id);

    expect([of(1)?.lane, of(1)?.lanes]).toEqual([0, 2]);
    expect([of(2)?.lane, of(2)?.lanes]).toEqual([1, 2]);
    expect([of(3)?.lane, of(3)?.lanes]).toEqual([0, 1]);
  });

  test('a changeover is not a double booking', () => {
    const layout = layoutRows(
      TREE,
      [booking(1, 1, '2026-09-25', '2026-09-28'), booking(2, 1, '2026-09-28', '2026-09-30')],
      DAYS,
    );

    expect(layout.get(1)?.bars.map((bar) => bar.lanes)).toEqual([1, 1]);
  });
});

describe('a villa', () => {
  test('the whole villa let shades every part; it is not a bar there', () => {
    const layout = layoutRows(TREE, [booking(1, 20, '2026-09-26', '2026-09-28')], DAYS);

    for (const part of [21, 22]) {
      expect(layout.get(part)?.bars).toEqual([]);
      expect(layout.get(part)?.shadows).toEqual([
        { from: 1.5, to: 3.5, cutStart: false, cutEnd: false, bookingId: 1, part: null },
      ]);
    }
  });

  test('a part let shades the villa, naming the part', () => {
    const layout = layoutRows(TREE, [booking(1, 21, '2026-09-26', '2026-09-28')], DAYS);

    expect(layout.get(20)?.shadows).toEqual([
      { from: 1.5, to: 3.5, cutStart: false, cutEnd: false, bookingId: 1, part: 'Villa East' },
    ]);
    expect(layout.get(22)?.shadows).toEqual([]);
  });
});

describe('a closed group', () => {
  test('counts its taken rooms night by night', () => {
    const layout = layoutRows(
      TREE,
      [
        booking(1, 10, '2026-09-25', '2026-09-27', { rooms: [{ property_id: 11 }] }),
        booking(2, 10, '2026-09-26', '2026-09-28', {
          rooms: [{ property_id: 11 }, { property_id: 12 }],
        }),
      ],
      DAYS,
    );

    // A night belongs to the day it starts on; the departure day is free.
    expect(layout.get(10)?.occupancy).toEqual([1, 2, 2, 0, 0, 0, 0]);
  });

  test('a villa let whole takes every part', () => {
    const layout = layoutRows(TREE, [booking(1, 20, '2026-09-26', '2026-09-27')], DAYS);

    expect(layout.get(20)?.occupancy).toEqual([0, 2, 0, 0, 0, 0, 0]);
  });

  test('a listing without rooms or parts has nothing to count', () => {
    expect(layoutRows(TREE, [], DAYS).get(1)?.occupancy).toEqual([]);
  });
});

describe('bookings read month by month', () => {
  test('a stay across the turn of a month comes twice and is kept once', () => {
    const stay = booking(1, 1, '2026-09-29', '2026-10-03');

    expect(mergeBookings([[stay], [stay, booking(2, 1, '2026-10-05', '2026-10-07')]])).toEqual([
      stay,
      booking(2, 1, '2026-10-05', '2026-10-07'),
    ]);
  });
});
