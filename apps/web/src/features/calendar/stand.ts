import type { Client } from '@/lib/supabase/use-client';

/**
 * The calendar stand (docs/f10-plan.md, §5): a stub client over a fixture,
 * for a local build run with `CALENDAR_FIXTURE=1`. The cloud takes no part,
 * and nothing here reads or writes a real row.
 *
 * The fixture is shaped like the cloud probe of 2026-09-23 — 70 ordinary
 * listings, 9 multi-unit listings with 31 rooms between them — plus the two
 * shapes the cloud does not have yet and the calendar must survive: a villa
 * with two parts, and a villa that also has rooms. Names follow the rule that
 * code is in English ("Listing 12", "Room 3"). Bookings and tasks join it in
 * 7.3 and 7.4.
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

/** Every request waits this long, so loading states are seen and measured. */
const LATENCY_MS = 150;

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

/**
 * A query builder that understands what the calendar's readers ask: the
 * filters, the order, and a thenable answer. More operators join with the
 * readers of 7.3–7.5.
 */
function queryOf(rows: readonly Row[]) {
  const filters: Filter[] = [];
  let order: { column: string; ascending: boolean } | null = null;

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    },
    neq: (column: string, value: unknown) => {
      filters.push((row) => row[column] !== value);
      return builder;
    },
    in: (column: string, values: readonly unknown[]) => {
      filters.push((row) => values.includes(row[column]));
      return builder;
    },
    is: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      order = { column, ascending: options?.ascending ?? true };
      return builder;
    },
    then<T>(resolve: (value: { data: Row[]; error: null }) => T) {
      const found = rows.filter((row) => filters.every((keep) => keep(row)));
      const sorted =
        order === null
          ? found
          : [...found].sort((a, b) => {
              const by = order as { column: string; ascending: boolean };
              const left = String(a[by.column]);
              const right = String(b[by.column]);
              return by.ascending ? left.localeCompare(right) : right.localeCompare(left);
            });
      return new Promise<{ data: Row[]; error: null }>((done) =>
        setTimeout(() => done({ data: sorted, error: null }), LATENCY_MS),
      ).then(resolve);
    },
  };
  return builder;
}

/** The stub, typed as the real client: the readers under test cannot tell. */
export function standClient(): Client {
  const tables: Record<string, readonly Row[]> = {
    properties: fixtureProperties() as unknown as Row[],
  };
  return { from: (table: string) => queryOf(tables[table] ?? []) } as unknown as Client;
}
