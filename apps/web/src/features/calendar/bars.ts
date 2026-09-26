import type { PropertyNode, TreeRow } from '@/lib/property-tree';

import { daysBetween } from './dates';
import type { CalendarBooking } from './schema';

/**
 * Where the bookings of a window are drawn (docs/f10-plan.md, 7.3, §3).
 *
 * Positions are in days from the window's first day; the grid multiplies by
 * its column width. A bar runs from the middle of the arrival day to the
 * middle of the departure day, so a changeover is two halves of one cell.
 */

export interface Span {
  from: number;
  to: number;
  /** The stay began before the window's first day. */
  cutStart: boolean;
  /** The stay goes on after the window's last day. */
  cutEnd: boolean;
}

export type BarKind = 'guest' | 'block';

export interface Bar extends Span {
  booking: CalendarBooking;
  kind: BarKind;
  /** Overlapping stays share the track: this bar's lane of `lanes`. */
  lane: number;
  lanes: number;
}

/**
 * A villa's shade (§3): the nights of the whole villa on each part, and the
 * nights of a part on the villa. It has no guest and is not pressed.
 */
export interface Shadow extends Span {
  bookingId: number;
  /** The part that is let; null when the whole villa is. */
  part: string | null;
}

export interface RowLayout {
  bars: Bar[];
  shadows: Shadow[];
  /** A group's taken rooms or parts per day of the window; empty for a leaf. */
  occupancy: number[];
}

export function spanOf(arrival: string, departure: string, days: readonly string[]): Span | null {
  if (days.length === 0) {
    return null;
  }
  const start = daysBetween(days[0], arrival) + 0.5;
  const end = daysBetween(days[0], departure) + 0.5;
  if (end <= start || end <= 0 || start >= days.length) {
    return null;
  }
  return {
    from: Math.max(start, 0),
    to: Math.min(end, days.length),
    cutStart: start < 0,
    cutEnd: end > days.length,
  };
}

/**
 * A block is not a guest: an owner stay, a stay Hostaway marks as a block, or
 * the office's own "#" booking (the server's rule, §2).
 */
export function barKind(booking: CalendarBooking): BarKind {
  return booking.status === 'ownerStay' || booking.is_block || booking.is_service_booking
    ? 'block'
    : 'guest';
}

/** The rows a stay is drawn on: each of its rooms, or its listing. */
function rowsOf(booking: CalendarBooking): number[] {
  return booking.rooms.length === 0
    ? [booking.property_id]
    : [...new Set(booking.rooms.map((room) => room.property_id))];
}

function groupByRow(bookings: readonly CalendarBooking[]): Map<number, CalendarBooking[]> {
  const byRow = new Map<number, CalendarBooking[]>();
  for (const booking of bookings) {
    for (const id of rowsOf(booking)) {
      byRow.set(id, [...(byRow.get(id) ?? []), booking]);
    }
  }
  return byRow;
}

function byArrival(a: CalendarBooking, b: CalendarBooking): number {
  return a.arrival_date.localeCompare(b.arrival_date) || a.id - b.id;
}

/**
 * Lanes over the stays of one row. Stays whose nights overlap form a cluster
 * and split the track between them; a changeover is not an overlap — the
 * nights meet, they do not share one. Computed over the dates, not the
 * window, so a bar keeps its lane while the window moves.
 */
function lanesOf(stays: readonly CalendarBooking[]): Map<number, { lane: number; lanes: number }> {
  const lanes = new Map<number, { lane: number; lanes: number }>();
  let cluster: { id: number; lane: number }[] = [];
  let laneEnds: string[] = [];
  let clusterEnd = '';

  const close = () => {
    for (const member of cluster) {
      lanes.set(member.id, { lane: member.lane, lanes: laneEnds.length });
    }
  };

  for (const stay of [...stays].sort(byArrival)) {
    if (stay.arrival_date >= clusterEnd) {
      close();
      cluster = [];
      laneEnds = [];
    }
    const free = laneEnds.findIndex((end) => end <= stay.arrival_date);
    const lane = free === -1 ? laneEnds.length : free;
    laneEnds =
      lane === laneEnds.length
        ? [...laneEnds, stay.departure_date]
        : laneEnds.map((end, at) => (at === lane ? stay.departure_date : end));
    cluster = [...cluster, { id: stay.id, lane }];
    clusterEnd = stay.departure_date > clusterEnd ? stay.departure_date : clusterEnd;
  }
  close();
  return lanes;
}

function barsOf(stays: readonly CalendarBooking[], days: readonly string[]): Bar[] {
  const lanes = lanesOf(stays);
  return [...stays].sort(byArrival).flatMap((booking) => {
    const span = spanOf(booking.arrival_date, booking.departure_date, days);
    const place = lanes.get(booking.id) ?? { lane: 0, lanes: 1 };
    return span === null ? [] : [{ ...span, booking, kind: barKind(booking), ...place }];
  });
}

function shadesOf(
  stays: readonly CalendarBooking[],
  part: string | null,
  days: readonly string[],
): Shadow[] {
  return stays.flatMap((booking) => {
    const span = spanOf(booking.arrival_date, booking.departure_date, days);
    return span === null ? [] : [{ ...span, bookingId: booking.id, part }];
  });
}

function shadowsOf<T extends TreeRow>(
  node: PropertyNode<T>,
  parent: PropertyNode<T> | undefined,
  byRow: ReadonlyMap<number, readonly CalendarBooking[]>,
  days: readonly string[],
): Shadow[] {
  if (node.kind === 'part' && parent !== undefined) {
    return shadesOf(byRow.get(parent.row.id) ?? [], null, days);
  }
  if (node.kind === 'villa') {
    return node.children
      .filter((child) => child.kind === 'part')
      .flatMap((part) => shadesOf(byRow.get(part.row.id) ?? [], part.row.name, days));
  }
  return [];
}

function covers(stays: readonly CalendarBooking[] | undefined, day: string): boolean {
  return (stays ?? []).some((stay) => stay.arrival_date <= day && day < stay.departure_date);
}

/**
 * A closed group's night-by-night count (§3): how many of its rooms or parts
 * are taken. A night belongs to the day it starts on. A villa let whole takes
 * every part.
 */
function occupancyOf<T extends TreeRow>(
  node: PropertyNode<T>,
  byRow: ReadonlyMap<number, readonly CalendarBooking[]>,
  days: readonly string[],
): number[] {
  if (node.children.length === 0) {
    return [];
  }
  const own = byRow.get(node.row.id);
  return days.map(
    (day) =>
      node.children.filter(
        (child) =>
          covers(byRow.get(child.row.id), day) || (child.kind === 'part' && covers(own, day)),
      ).length,
  );
}

/** Bars, shades and counts of every row of the tree, by property id. */
export function layoutRows<T extends TreeRow>(
  tree: readonly PropertyNode<T>[],
  bookings: readonly CalendarBooking[],
  days: readonly string[],
): Map<number, RowLayout> {
  const byRow = groupByRow(bookings);
  const layout = new Map<number, RowLayout>();

  const visit = (node: PropertyNode<T>, parent: PropertyNode<T> | undefined) => {
    layout.set(node.row.id, {
      bars: barsOf(byRow.get(node.row.id) ?? [], days),
      shadows: shadowsOf(node, parent, byRow, days),
      occupancy: occupancyOf(node, byRow, days),
    });
    for (const child of node.children) {
      visit(child, node);
    }
  };
  for (const node of tree) {
    visit(node, undefined);
  }
  return layout;
}

/**
 * The bookings of several months as one list. A stay across the turn of a
 * month is read with both and kept once.
 */
export function mergeBookings(months: readonly (readonly CalendarBooking[])[]): CalendarBooking[] {
  const seen = new Set<number>();
  return months.flat().filter((booking) => {
    if (seen.has(booking.id)) {
      return false;
    }
    seen.add(booking.id);
    return true;
  });
}
