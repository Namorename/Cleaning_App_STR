/**
 * The stand at scale (docs/f10-plan.md, §5, 7.6): ×3 is the fixture three
 * times over, each copy with its ids moved by a round number and its names
 * marked with the copy ("Listing 12 · 2"). Every case of 7.3–7.5 comes along
 * in each copy, on the copy's own rows.
 */

type Row = Record<string, unknown>;

/** Far above any id of one copy: bookings count from 1, rows from 1000. */
const COPY_OFFSET = 100_000;

const shifted = (value: unknown, shift: number): unknown =>
  typeof value === 'number' ? value + shift : value;

const copyName = (name: unknown, copy: number): string => `${String(name)} · ${copy + 1}`;

/** A uuid of another copy: its first eight hex digits carry the copy. */
const copyUuid = (value: unknown, copy: number): unknown =>
  typeof value === 'string' ? `${String(copy).padStart(8, 'a')}${value.slice(8)}` : value;

function copyProperty(row: Row, copy: number): Row {
  const shift = copy * COPY_OFFSET;
  return {
    ...row,
    id: shifted(row.id, shift),
    parent_id: shifted(row.parent_id, shift),
    hostaway_unit_id: shifted(row.hostaway_unit_id, shift),
    name: copyName(row.name, copy),
  };
}

function copyBooking(row: Row, copy: number): Row {
  const shift = copy * COPY_OFFSET;
  const rooms = (row.rooms as readonly Row[]).map((room) => ({
    property_id: shifted(room.property_id, shift),
  }));
  return {
    ...row,
    id: shifted(row.id, shift),
    property_id: shifted(row.property_id, shift),
    rooms,
  };
}

function copyTask(row: Row, copy: number): Row {
  const shift = copy * COPY_OFFSET;
  const place = row.property as Row | null;
  const parent = place?.parent as Row | null | undefined;
  return {
    ...row,
    id: copyUuid(row.id, copy),
    property_id: shifted(row.property_id, shift),
    reservation_id: shifted(row.reservation_id, shift),
    problem_id: copyUuid(row.problem_id, copy),
    property:
      place === null
        ? null
        : {
            ...place,
            name: copyName(place.name, copy),
            hostaway_unit_id: shifted(place.hostaway_unit_id, shift),
            parent:
              parent === null || parent === undefined
                ? null
                : { name: copyName(parent.name, copy) },
          },
  };
}

export interface StandTables {
  properties: readonly Row[];
  reservations: readonly Row[];
  tasks: readonly Row[];
}

/** The fixture `scale` times: copy 0 is the fixture itself. */
export function scaledTables(tables: StandTables, scale: number): StandTables {
  const copies = Array.from({ length: Math.max(1, Math.floor(scale)) }, (_, copy) => copy);
  const each = (rows: readonly Row[], copyOf: (row: Row, copy: number) => Row) =>
    copies.flatMap((copy) => (copy === 0 ? rows : rows.map((row) => copyOf(row, copy))));
  return {
    properties: each(tables.properties, copyProperty),
    reservations: each(tables.reservations, copyBooking),
    tasks: each(tables.tasks, copyTask),
  };
}
