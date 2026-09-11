/**
 * Normalize a Hostaway listing into a public.properties row.
 *
 * The input is a foreign feed: 145 fields, some of which arrive as strings
 * instead of numbers, as empty strings instead of null, or are missing
 * entirely on individual listings. Hence `unknown` and explicit narrowing
 * rather than a cast.
 */

import { isRecord, toFiniteNumber, toTrimmedString } from "./coerce.ts";

/** The schema requires timezone NOT NULL: cleaning deadlines are computed in property-local time. */
const DEFAULT_TIMEZONE = "UTC";

export interface PropertyRow {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  country_code: string | null;
  timezone: string;
  bedrooms: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  /** Earliest guest arrival, property-local. Cleaning must finish by then. */
  check_in_time: string | null;
  /** Guest departure, property-local. Cleaning can start from then. */
  check_out_time: string | null;
  synced_at: string;
}

/**
 * Hostaway reports these as whole hours (`10`, `15`), not as clock strings.
 * Converted to `HH:MM:SS` so the column can hold a half-hour checkout later
 * without a migration.
 */
function toTimeOfDay(value: unknown): string | null {
  const hour = toFiniteNumber(value);
  if (hour === null || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:00:00`;
}

/**
 * The name shown to the cleaner.
 *
 * internalListingName is the working code, e.g. "CZ - Brehova old Apt 51 Fl.5
 * 8G 6BR 2B"; name is the marketing headline from the listing. The task list
 * needs the former.
 */
function pickName(listing: Record<string, unknown>): string | null {
  return toTrimmedString(listing.internalListingName) ?? toTrimmedString(listing.name);
}

/**
 * Note that is_active is deliberately absent from the result. Hostaway does
 * not report such a field, and writing a default would undo a manual
 * deactivation in the manager panel on every sync run.
 */
export function normalizeListing(raw: unknown, syncedAt: string): PropertyRow {
  if (!isRecord(raw)) {
    throw new TypeError(`Hostaway listing must be an object, got: ${typeof raw}`);
  }

  const id = toFiniteNumber(raw.id);
  if (id === null) {
    throw new TypeError(
      `Hostaway listing has no usable id: got ${JSON.stringify(raw.id) ?? "undefined"}`,
    );
  }

  const name = pickName(raw);
  if (name === null) {
    throw new TypeError(`Hostaway listing ${id} has neither internalListingName nor name`);
  }

  return {
    id,
    name,
    address: toTrimmedString(raw.address),
    city: toTrimmedString(raw.city),
    country_code: toTrimmedString(raw.countryCode),
    timezone: toTrimmedString(raw.timeZoneName) ?? DEFAULT_TIMEZONE,
    bedrooms: toFiniteNumber(raw.bedroomsNumber),
    bathrooms: toFiniteNumber(raw.bathroomsNumber),
    max_guests: toFiniteNumber(raw.personCapacity),
    check_in_time: toTimeOfDay(raw.checkInTimeStart),
    check_out_time: toTimeOfDay(raw.checkOutTime),
    synced_at: syncedAt,
  };
}

/**
 * A room inside a multi-unit listing, as a properties row waiting for its id.
 *
 * The id is deliberately absent. Hostaway numbers units in a space of its own
 * and the row id is that number shifted clear of the listing ids; the shift
 * lives in `public.property_id_for_unit()` so the rule has one home, and the
 * sync RPC applies it. Sending an id from here would be a second copy of it.
 *
 * Capacity is absent for a different reason: Hostaway reports bedrooms,
 * bathrooms and guests per LISTING. Those numbers describe all the rooms
 * together and are wrong for any one of them, so a unit carries none — empty
 * beats untrue.
 */
export interface PropertyUnitRow {
  hostaway_unit_id: number;
  parent_id: number;
  name: string;
  /** Inherited from the listing: a room is at the same address, in the same timezone. */
  address: string | null;
  city: string | null;
  country_code: string | null;
  timezone: string;
  check_in_time: string | null;
  check_out_time: string | null;
  synced_at: string;
}

/**
 * The rooms of one listing.
 *
 * Empty for the seventy of seventy-nine listings that have none, and that is
 * the ordinary case rather than a problem.
 *
 * A unit whose name is missing is still returned, named by its own number:
 * losing the row would lose every cleaning that belongs to the room. A unit
 * with no usable id is dropped — there is nothing to hang it on.
 */
export function normalizeUnits(
  raw: unknown,
  parent: Readonly<PropertyRow>,
  syncedAt: string,
): PropertyUnitRow[] {
  if (!isRecord(raw)) {
    throw new TypeError(`Hostaway listing must be an object, got: ${typeof raw}`);
  }

  const units = raw.listingUnits;
  if (!Array.isArray(units)) {
    return [];
  }

  const rows: PropertyUnitRow[] = [];

  for (const unit of units) {
    if (!isRecord(unit)) {
      continue;
    }

    const unitId = toFiniteNumber(unit.id);
    if (unitId === null) {
      continue;
    }

    rows.push({
      hostaway_unit_id: unitId,
      parent_id: parent.id,
      name: toTrimmedString(unit.name) ?? `Unit ${unitId}`,
      address: parent.address,
      city: parent.city,
      country_code: parent.country_code,
      timezone: parent.timezone,
      check_in_time: parent.check_in_time,
      check_out_time: parent.check_out_time,
      synced_at: syncedAt,
    });
  }

  return rows;
}
