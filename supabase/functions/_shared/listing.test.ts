import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { normalizeListing, normalizeUnits } from "./listing.ts";

const SYNCED_AT = "2026-08-27T16:00:00.000Z";

/** A snapshot of a real Hostaway response, trimmed to the fields we use (the live one has 145). */
function makeListing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 98352,
    name: "Billionaires Club 5BD | Sauna | heart of prague",
    internalListingName: "CZ - Brehova old Apt 51 Fl.5  8G 6BR 2B",
    address: "Břehová 208 5 floor",
    city: "Praha 1",
    countryCode: "CZ",
    state: "Hlavní město Praha",
    zipcode: "110 00",
    timeZoneName: "Europe/Prague",
    bedroomsNumber: 5,
    bathroomsNumber: 2,
    personCapacity: 8,
    checkInTimeStart: 15,
    checkOutTime: 10,
    propertyTypeId: 9,
    ...overrides,
  };
}

Deno.test("normalizes a complete listing into a properties row", () => {
  const row = normalizeListing(makeListing(), SYNCED_AT);

  assertEquals(row, {
    id: 98352,
    name: "CZ - Brehova old Apt 51 Fl.5  8G 6BR 2B",
    address: "Břehová 208 5 floor",
    city: "Praha 1",
    country_code: "CZ",
    timezone: "Europe/Prague",
    bedrooms: 5,
    bathrooms: 2,
    max_guests: 8,
    check_in_time: "15:00:00",
    check_out_time: "10:00:00",
    synced_at: SYNCED_AT,
  });
});

Deno.test("prefers internalListingName over the marketing name", () => {
  // The cleaner looks the property up by its working code, not by the ad headline.
  const row = normalizeListing(makeListing(), SYNCED_AT);
  assertEquals(row.name, "CZ - Brehova old Apt 51 Fl.5  8G 6BR 2B");
});

Deno.test("falls back to name when internalListingName is blank", () => {
  for (const empty of [null, "", "   ", undefined]) {
    const row = normalizeListing(makeListing({ internalListingName: empty }), SYNCED_AT);
    assertEquals(row.name, "Billionaires Club 5BD | Sauna | heart of prague");
  }
});

Deno.test("falls back to UTC when no timezone arrives", () => {
  // timezone is NOT NULL in the schema: cleaning deadlines are property-local.
  const row = normalizeListing(makeListing({ timeZoneName: null }), SYNCED_AT);
  assertEquals(row.timezone, "UTC");
});

// ---------------------------------------------------------------------------
//  Check-in and check-out times
// ---------------------------------------------------------------------------

Deno.test("whole hours become clock times", () => {
  // Hostaway reports 15 and 10, not "15:00". Every listing in this account
  // uses the same pair, which is a five-hour window on a same-day turnover.
  const row = normalizeListing(makeListing({ checkInTimeStart: 16, checkOutTime: 11 }), SYNCED_AT);
  assertEquals(row.check_in_time, "16:00:00");
  assertEquals(row.check_out_time, "11:00:00");
});

Deno.test("midnight is a valid hour, not a missing value", () => {
  const row = normalizeListing(makeListing({ checkOutTime: 0 }), SYNCED_AT);
  assertEquals(row.check_out_time, "00:00:00");
});

Deno.test("hours arriving as strings are accepted", () => {
  const row = normalizeListing(makeListing({ checkInTimeStart: "15" }), SYNCED_AT);
  assertEquals(row.check_in_time, "15:00:00");
});

Deno.test("out-of-range and non-integer hours become null", () => {
  // A bad deadline is worse than no deadline: the generator can fall back,
  // but it cannot detect a silently wrong 25:00.
  for (const bad of [24, -1, 10.5, "noon", "", null, undefined, {}]) {
    const row = normalizeListing(makeListing({ checkOutTime: bad }), SYNCED_AT);
    assertEquals(row.check_out_time, null, `hour ${JSON.stringify(bad)} should be rejected`);
  }
});

// ---------------------------------------------------------------------------
//  Type coercion
// ---------------------------------------------------------------------------

Deno.test("numeric fields arriving as strings are coerced", () => {
  // Hostaway returns numbers as strings for some listings.
  const row = normalizeListing(
    makeListing({ id: "98352", bedroomsNumber: "5", personCapacity: "8" }),
    SYNCED_AT,
  );

  assertEquals(row.id, 98352);
  assertEquals(row.bedrooms, 5);
  assertEquals(row.max_guests, 8);
});

Deno.test("missing counts become null, not zero", () => {
  // Zero bedrooms is meaningful (a studio), so "unknown" must not collapse into it.
  const row = normalizeListing(
    makeListing({ bedroomsNumber: null, bathroomsNumber: undefined, personCapacity: "" }),
    SYNCED_AT,
  );

  assertEquals(row.bedrooms, null);
  assertEquals(row.bathrooms, null);
  assertEquals(row.max_guests, null);
});

Deno.test("zero bedrooms stays zero", () => {
  const row = normalizeListing(makeListing({ bedroomsNumber: 0 }), SYNCED_AT);
  assertEquals(row.bedrooms, 0);
});

Deno.test("blank address fields become null", () => {
  const row = normalizeListing(
    makeListing({ address: "", city: "   ", countryCode: null }),
    SYNCED_AT,
  );

  assertEquals(row.address, null);
  assertEquals(row.city, null);
  assertEquals(row.country_code, null);
});

Deno.test("fractional bathroom counts are preserved", () => {
  const row = normalizeListing(makeListing({ bathroomsNumber: 2.5 }), SYNCED_AT);
  assertEquals(row.bathrooms, 2.5);
});

Deno.test("is_active is not carried over: Hostaway does not report it", () => {
  // The sync must not undo a manual deactivation in the manager panel.
  const row = normalizeListing(makeListing(), SYNCED_AT) as unknown as Record<string, unknown>;
  assertEquals("is_active" in row, false);
});

// ---------------------------------------------------------------------------
//  Boundary checks
// ---------------------------------------------------------------------------

Deno.test("rejects a listing without a usable id", () => {
  for (const badId of [null, undefined, "", "not-a-number", {}, []]) {
    assertThrows(() => normalizeListing(makeListing({ id: badId }), SYNCED_AT), Error, "id");
  }
});

Deno.test("rejects a listing with no name at all", () => {
  assertThrows(
    () => normalizeListing(makeListing({ name: null, internalListingName: null }), SYNCED_AT),
    Error,
    "98352",
  );
});

Deno.test("rejects anything that is not an object", () => {
  for (const notAnObject of [null, undefined, 42, "string", [], true]) {
    assertThrows(() => normalizeListing(notAnObject, SYNCED_AT), Error);
  }
});

// ---------------------------------------------------------------------------
//  Rooms inside a multi-unit listing
// ---------------------------------------------------------------------------

/** Real shape from listing 412432, which holds seven rooms. */
const NADRAZNI_UNITS = [
  { id: 64266, name: "Unit 6 - 1 floor - keypad 638247#", ground: null, unitNumber: null, listingMapIdUnit: null },
  { id: 64267, name: "Unit 8 - 3rd floor - lockbox 8251", ground: null, unitNumber: null, listingMapIdUnit: null },
];

Deno.test("a listing with no units yields none — the ordinary case", () => {
  const parent = normalizeListing(makeListing(), SYNCED_AT);

  assertEquals(normalizeUnits(makeListing(), parent, SYNCED_AT), []);
});

Deno.test("listingUnits absent altogether is not an error", () => {
  const raw = makeListing();
  delete raw.listingUnits;
  const parent = normalizeListing(raw, SYNCED_AT);

  assertEquals(normalizeUnits(raw, parent, SYNCED_AT), []);
});

Deno.test("a room inherits the address and the times of its listing", () => {
  const raw = makeListing({ id: 412432, listingUnits: NADRAZNI_UNITS });
  const parent = normalizeListing(raw, SYNCED_AT);

  const units = normalizeUnits(raw, parent, SYNCED_AT);

  assertEquals(units.length, 2);
  assertEquals(units[0], {
    hostaway_unit_id: 64266,
    parent_id: 412432,
    name: "Unit 6 - 1 floor - keypad 638247#",
    address: parent.address,
    city: parent.city,
    country_code: parent.country_code,
    timezone: parent.timezone,
    check_in_time: parent.check_in_time,
    check_out_time: parent.check_out_time,
    synced_at: SYNCED_AT,
  });
});

// The id belongs to public.property_id_for_unit(), and a second copy of the
// shift here is exactly how the two would come to disagree.
Deno.test("a room carries no row id of its own", () => {
  const raw = makeListing({ listingUnits: NADRAZNI_UNITS });
  const parent = normalizeListing(raw, SYNCED_AT);

  assertEquals("id" in normalizeUnits(raw, parent, SYNCED_AT)[0], false);
});

// Hostaway reports capacity per listing. Ten guests across four rooms says
// nothing true about one of them.
Deno.test("a room carries no capacity of its own", () => {
  const raw = makeListing({ personCapacity: 10, bedroomsNumber: 2, listingUnits: NADRAZNI_UNITS });
  const parent = normalizeListing(raw, SYNCED_AT);
  const unit = normalizeUnits(raw, parent, SYNCED_AT)[0];

  assertEquals("max_guests" in unit, false);
  assertEquals("bedrooms" in unit, false);
  assertEquals("bathrooms" in unit, false);
});

// Losing the row would lose every cleaning that belongs to the room.
Deno.test("a nameless room is kept and named by its number", () => {
  const raw = makeListing({ listingUnits: [{ id: 64268, name: "   " }] });
  const parent = normalizeListing(raw, SYNCED_AT);

  assertEquals(normalizeUnits(raw, parent, SYNCED_AT)[0].name, "Unit 64268");
});

// There is nothing to hang a room without an id on: the row id is derived
// from it and the reservation binding resolves through it.
Deno.test("a room with no usable id is dropped, the rest survive", () => {
  const raw = makeListing({
    listingUnits: [{ id: null, name: "Broken" }, ...NADRAZNI_UNITS],
  });
  const parent = normalizeListing(raw, SYNCED_AT);

  const units = normalizeUnits(raw, parent, SYNCED_AT);

  assertEquals(units.length, 2);
  assertEquals(units.map((unit) => unit.hostaway_unit_id), [64266, 64267]);
});

Deno.test("listingUnits that is not an array is ignored rather than thrown at", () => {
  const raw = makeListing({ listingUnits: "nope" });
  const parent = normalizeListing(raw, SYNCED_AT);

  assertEquals(normalizeUnits(raw, parent, SYNCED_AT), []);
});
