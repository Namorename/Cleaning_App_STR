import { todayIso } from '@/lib/format-date';
import type { Client } from '@/lib/supabase/use-client';

import { addDays } from './dates';

/**
 * The calendar stand (docs/f10-plan.md, §5): a stub client over a fixture,
 * for a local build run with `CALENDAR_FIXTURE=1`. The cloud takes no part,
 * and nothing here reads or writes a real row.
 *
 * The fixture is shaped like the cloud probe of 2026-09-23 — 70 ordinary
 * listings, 9 multi-unit listings with 31 rooms between them — plus the two
 * shapes the cloud does not have yet and the calendar must survive: a villa
 * with two parts, and a villa that also has rooms. Names follow the rule that
 * code is in English ("Listing 12", "Room 3"). Bookings joined it in 7.3;
 * tasks join it in 7.4.
 */

interface FixtureProperty {
  id: number;
  name: string;
  parent_id: number | null;
  hostaway_unit_id: number | null;
  status: string;
  timezone: string;
}

const TIMEZONE = 'Europe/Prague';
/** Rooms per multi-unit listing: 2 to 7, 31 in all — the cloud's count. */
const ROOMS_PER_MULTI_UNIT = [2, 3, 3, 3, 3, 3, 4, 3, 7];

function listing(id: number, name: string, parent: number | null = null): FixtureProperty {
  return {
    id,
    name,
    parent_id: parent,
    hostaway_unit_id: null,
    status: 'active',
    timezone: TIMEZONE,
  };
}

function room(id: number, name: string, parent: number, status = 'active'): FixtureProperty {
  return { id, name, parent_id: parent, hostaway_unit_id: id, status, timezone: TIMEZONE };
}

export function fixtureProperties(): FixtureProperty[] {
  const ordinary = Array.from({ length: 70 }, (_, at) => listing(1000 + at, `Listing ${at + 1}`));

  const multiUnit = ROOMS_PER_MULTI_UNIT.flatMap((rooms, at) => {
    const id = 2000 + at * 10;
    return [
      listing(id, `Multi ${at + 1}`),
      ...Array.from({ length: rooms }, (_, number) =>
        // One room under repair, so the row badge has something to show.
        room(
          id + number + 1,
          `Room ${number + 1}`,
          id,
          at === 0 && number === 0 ? 'maintenance' : 'active',
        ),
      ),
    ];
  });

  const villas = [
    listing(3000, 'Villa Whole'),
    listing(3001, 'Villa East', 3000),
    listing(3002, 'Villa West', 3000),
    listing(3100, 'Villa With Rooms'),
    room(3101, 'Room 1', 3100),
    room(3102, 'Room 2', 3100),
    listing(3103, 'Villa Annex', 3100),
  ];

  return [...ordinary, ...multiUnit, ...villas];
}

interface FixtureBooking {
  id: number;
  property_id: number;
  arrival_date: string;
  departure_date: string;
  status: string;
  is_block: boolean;
  guest_name: string | null;
  guests_count: number | null;
  check_in_time: string | null;
  check_out_time: string | null;
  rooms: { property_id: number }[];
  is_service_booking: boolean;
}

/** How far around today the fixture books: the months the arrows reach first. */
const BOOKED_FROM = -45;
const BOOKED_TO = 75;

/** The listings that carry one case each of 7.3, and so no stays of the pattern. */
const CASE_ROWS = new Set([1000, 1001, 1002, 1003, 2000, 2001, 2002, 3000, 3001, 3002]);

/**
 * Bookings around `today`, one stay after another on every listing and room:
 * mostly changeovers, now and then a free night. Then the cases 7.3 is
 * checked on (docs/f10-plan.md, 7.3 [агент]), each on its own row so it is
 * found by name: a 99-night stay, a double booking, an owner stay, the
 * office's own "#" booking, a stay of two rooms, and a villa let whole and in
 * part at other times, so the shade shows both ways.
 */
export function fixtureBookings(today: string): FixtureBooking[] {
  let nextId = 1;
  const stay = (
    property: number,
    arrival: number,
    nights: number,
    extra: Partial<FixtureBooking> = {},
  ): FixtureBooking => {
    const id = nextId++;
    return {
      id,
      property_id: property,
      arrival_date: addDays(today, arrival),
      departure_date: addDays(today, arrival + nights),
      status: 'new',
      is_block: false,
      guest_name: `Guest ${String(id).padStart(4, '0')}`,
      guests_count: 1 + (id % 4),
      check_in_time: '15:00:00',
      check_out_time: '10:00:00',
      rooms: [],
      is_service_booking: false,
      ...extra,
    };
  };

  // One stay after another on a row; the pattern differs from row to row.
  const chain = (seed: number, booked: (arrival: number, nights: number) => FixtureBooking) => {
    const stays: FixtureBooking[] = [];
    let arrival = BOOKED_FROM + (seed % 7);
    for (let step = 0; arrival < BOOKED_TO; step += 1) {
      const nights = 1 + ((seed + step) % 5);
      stays.push(booked(arrival, nights));
      arrival += nights + ((seed + step) % 3 === 0 ? 1 : 0);
    }
    return stays;
  };

  const properties = fixtureProperties();
  const hasRooms = (id: number) =>
    properties.some((other) => other.parent_id === id && other.hostaway_unit_id !== null);
  const listings = properties
    .filter((row) => row.hostaway_unit_id === null && !CASE_ROWS.has(row.id) && !hasRooms(row.id))
    .flatMap((row) => chain(row.id, (arrival, nights) => stay(row.id, arrival, nights)));
  const rooms = properties
    .filter((row) => row.hostaway_unit_id !== null && !CASE_ROWS.has(row.id))
    .flatMap((row) =>
      chain(row.id, (arrival, nights) =>
        stay(row.parent_id as number, arrival, nights, { rooms: [{ property_id: row.id }] }),
      ),
    );

  const cases = [
    // Listing 1: 99 nights, cut at both edges of any window up to 30 days.
    stay(1000, -40, 99),
    // Listing 2: a double booking, then a changeover.
    stay(1001, -1, 3),
    stay(1001, 1, 3),
    stay(1001, 4, 2),
    // Listing 3: an owner stay — a block, no guest.
    stay(1002, 0, 4, { status: 'ownerStay', guest_name: null }),
    // Listing 4: the office's own work, "#…" — a block, its name in the card.
    stay(1003, 1, 2, { guest_name: '#Boiler - repair', is_service_booking: true }),
    // Multi 1: one stay of both rooms, then each room on its own.
    stay(2000, 0, 3, { rooms: [{ property_id: 2001 }, { property_id: 2002 }] }),
    stay(2000, 4, 2, { rooms: [{ property_id: 2001 }] }),
    stay(2000, 5, 2, { rooms: [{ property_id: 2002 }] }),
    // Villa Whole: let whole, then its parts alone.
    stay(3000, 0, 3),
    stay(3001, 4, 3),
    stay(3002, 8, 2),
  ];

  return [...listings, ...rooms, ...cases];
}

/** Every request waits this long, so loading states are seen and measured. */
const LATENCY_MS = 150;

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

interface Order {
  column: string;
  ascending: boolean;
}

function compare(a: unknown, b: unknown): number {
  return typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b));
}

/**
 * A query builder that understands what the calendar's readers ask: the
 * filters, the order, a page with its count, and a thenable answer. More
 * operators join with the readers of 7.4–7.5.
 */
function queryOf(rows: readonly Row[]) {
  const filters: Filter[] = [];
  const orders: Order[] = [];
  let page: { from: number; to: number } | null = null;
  let isCounted = false;

  const builder = {
    select: (_columns?: string, options?: { count?: string }) => {
      isCounted = options?.count === 'exact';
      return builder;
    },
    eq: (column: string, value: unknown) => keep((row) => row[column] === value),
    neq: (column: string, value: unknown) => keep((row) => row[column] !== value),
    in: (column: string, values: readonly unknown[]) => keep((row) => values.includes(row[column])),
    is: (column: string, value: unknown) => keep((row) => row[column] === value),
    lt: (column: string, value: unknown) => keep((row) => compare(row[column], value) < 0),
    gte: (column: string, value: unknown) => keep((row) => compare(row[column], value) >= 0),
    order: (column: string, options?: { ascending?: boolean }) => {
      orders.push({ column, ascending: options?.ascending ?? true });
      return builder;
    },
    range: (from: number, to: number) => {
      page = { from, to };
      return builder;
    },
    then<T>(resolve: (value: { data: Row[]; error: null; count: number | null }) => T) {
      const found = rows.filter((row) => filters.every((test) => test(row)));
      const sorted = [...found].sort((a, b) => {
        for (const { column, ascending } of orders) {
          const order = compare(a[column], b[column]);
          if (order !== 0) {
            return ascending ? order : -order;
          }
        }
        return 0;
      });
      const range = page as { from: number; to: number } | null;
      const data = range === null ? sorted : sorted.slice(range.from, range.to + 1);
      const answer = { data, error: null, count: isCounted ? found.length : null };
      return new Promise<typeof answer>((done) => setTimeout(() => done(answer), LATENCY_MS)).then(
        resolve,
      );
    },
  };

  function keep(filter: Filter) {
    filters.push(filter);
    return builder;
  }

  return builder;
}

/** The stub, typed as the real client: the readers under test cannot tell. */
export function standClient(): Client {
  const tables: Record<string, readonly Row[]> = {
    properties: fixtureProperties() as unknown as Row[],
    reservations: fixtureBookings(todayIso()) as unknown as Row[],
  };
  return { from: (table: string) => queryOf(tables[table] ?? []) } as unknown as Client;
}
