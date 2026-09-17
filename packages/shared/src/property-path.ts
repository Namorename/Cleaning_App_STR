/**
 * How a place is written when it is a room inside a house.
 *
 * The rule was written twice — once for the phone, once for the panel — and a
 * third caller made that a decision waiting to drift. What a cleaner reports
 * and what a manager searches for have to be spelled the same way, down to the
 * dash, or the panel's search stops finding the phone's reports.
 *
 * An em dash with spaces, not a hyphen: room names are already full of
 * hyphens ("1 - 2109"), and a second one would blur where the house ends.
 */
export const PROPERTY_PATH_SEPARATOR = ' — ';

/** The house, or the house and the room inside it, as one line. */
export function propertyPath(building: string, room: string | null): string {
  return room === null ? building : `${building}${PROPERTY_PATH_SEPARATOR}${room}`;
}

/**
 * A row that can name a place: its own name, whether it is a room, and the
 * house it hangs under.
 *
 * Both extras are optional because a row restored from the phone's disk cache
 * carries only the keys the build that wrote it knew about.
 */
export interface PlaceRow {
  name: string;
  hostaway_unit_id?: number | null;
  parent?: { name: string } | null;
}

/** The house, and the room inside it when the row is one. */
export interface PlaceParts {
  building: string;
  room: string | null;
}

/**
 * Which half of the name is the house and which is the room.
 *
 * The roomness test is `hostaway_unit_id`, never the parent link alone.
 * `parent_id` also joins a part of a combined listing, and a part is a real
 * listing with its own calendar and its own guests: prefixing it with its
 * neighbour's name would be plainly wrong.
 *
 * `?? null` rather than a plain read: on the phone these rows come back from
 * disk through `JSON.parse`, so a row written by an older build reaches this
 * line with the keys that build knew and no others. Zod fills the defaults on
 * the way in from the network; nothing fills them on the way in from disk.
 *
 * A room whose house is missing keeps its own name. It should not happen, but
 * blanking the place of every row standing on it is a worse answer than a name
 * that is merely incomplete.
 */
export function splitPlace(row: PlaceRow): PlaceParts {
  const parent = row.parent ?? null;
  const unitId = row.hostaway_unit_id ?? null;

  return parent === null || unitId === null
    ? { building: row.name, room: null }
    : { building: parent.name, room: row.name };
}

/**
 * The place of a joined row in one line, or null when nothing was joined.
 *
 * This is the one call every screen outside tasks should make. Writing the
 * test by hand is how eight copies of "is this a room" came to exist, and a
 * hand-rolled separator is invisible on screen while silently breaking the
 * panel's search over the phone's reports.
 */
export function propertyPathOf(row: PlaceRow | null | undefined): string | null {
  if (row === null || row === undefined) {
    return null;
  }

  const { building, room } = splitPlace(row);
  return propertyPath(building, room);
}
