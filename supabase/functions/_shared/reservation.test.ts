import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { normalizeReservation, reservationUnits } from "./reservation.ts";

const SYNCED_AT = "2026-08-27T18:00:00.000Z";

/** A snapshot of a real Hostaway response, trimmed to the fields we use (the live one has 137). */
function makeReservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 65289672,
    listingMapId: 495979,
    channelId: 2018,
    channelName: "airbnbOfficial",
    status: "modified",
    guestName: "Test Guest",
    arrivalDate: "2026-08-28",
    departureDate: "2026-08-31",
    numberOfGuests: 5,
    totalPrice: 6948.4,
    checkInTime: 15,
    checkOutTime: 10,
    isManuallyChecked: 0,
    // Live shape: an ordinary listing carries the field and leaves it empty —
    // checked against bookings on 98352 and 115202 on 2026-09-12. It is the
    // difference between "no rooms" and "nothing said", so the fixture states it.
    reservationUnit: [],
    ...overrides,
  };
}

Deno.test("normalizes a complete booking into a reservations row", () => {
  const row = normalizeReservation(makeReservation(), SYNCED_AT);

  assertEquals(row, {
    id: 65289672,
    property_id: 495979,
    arrival_date: "2026-08-28",
    departure_date: "2026-08-31",
    status: "modified",
    channel_id: 2018,
    guest_name: "Test Guest",
    guests_count: 5,
    total_price: 6948.4,
    is_block: false,
    check_in_time: "15:00",
    check_out_time: "10:00",
    synced_at: SYNCED_AT,
  });
});

// A booking's hours are not the listing's standard window: a guest can buy a
// late checkout. On live data 22 bookings differ from their listing on arrival
// and 2 on departure. Hostaway reports whole hours, never minutes.
Deno.test("the hours of a booking become times", () => {
  const row = normalizeReservation(
    makeReservation({ checkInTime: 16, checkOutTime: 12 }),
    SYNCED_AT,
  );

  assertEquals(row.check_in_time, "16:00");
  assertEquals(row.check_out_time, "12:00");
});

Deno.test("missing hours give null — the window then comes from the listing", () => {
  const raw = makeReservation();
  delete raw.checkInTime;
  delete raw.checkOutTime;

  const row = normalizeReservation(raw, SYNCED_AT);

  assertEquals(row.check_in_time, null);
  assertEquals(row.check_out_time, null);
});

// Zero arrives when the channel reported no time (seen on an Airbnb booking
// for a listing that checks in at 15:00). It is stored as it came: reading
// anything into it happens in one place, public.reservation_cleaning_window.
Deno.test("zero is kept as midnight rather than thrown away", () => {
  const row = normalizeReservation(makeReservation({ checkInTime: 0 }), SYNCED_AT);

  assertEquals(row.check_in_time, "00:00");
});

Deno.test("an hour outside the day is dropped", () => {
  for (const hour of [24, -1, 99]) {
    const row = normalizeReservation(makeReservation({ checkInTime: hour }), SYNCED_AT);
    assertEquals(row.check_in_time, null, `hour ${hour}`);
  }
});

Deno.test("a fractional hour is dropped — the column holds whole hours", () => {
  const row = normalizeReservation(makeReservation({ checkOutTime: 12.5 }), SYNCED_AT);

  assertEquals(row.check_out_time, null);
});

Deno.test("listingMapId becomes property_id", () => {
  const row = normalizeReservation(makeReservation({ listingMapId: 98352 }), SYNCED_AT);
  assertEquals(row.property_id, 98352);
});

// ---------------------------------------------------------------------------
//  is_block: the one unambiguous signal — the ownerStay status
// ---------------------------------------------------------------------------

Deno.test("ownerStay is marked a block", () => {
  const row = normalizeReservation(makeReservation({ status: "ownerStay" }), SYNCED_AT);
  assertEquals(row.is_block, true);
});

Deno.test("the ordinary statuses are not blocks", () => {
  const statuses = ["new", "modified", "cancelled", "expired", "inquiry", "inquiryPreapproved"];
  for (const status of statuses) {
    const row = normalizeReservation(makeReservation({ status }), SYNCED_AT);
    assertEquals(row.is_block, false, `status ${status} was wrongly marked a block`);
  }
});

Deno.test("the direct channel at zero price is NOT a block", () => {
  // Live data under channelId=2000 turned up promo showings and photo shoots:
  // 'andrej promo show', price 0, status modified. People were in the flat and
  // it needed cleaning. Missing a needed cleaning is worse than scheduling a
  // spare one, so neither channel nor price decides a block.
  const row = normalizeReservation(
    makeReservation({ channelId: 2000, totalPrice: 0, guestName: "andrej promo show" }),
    SYNCED_AT,
  );
  assertEquals(row.is_block, false);
});

Deno.test("the guest name does not decide a block", () => {
  // 'block', 'Upgrade', 'Foceni', 'NY Block' have all turned up — arbitrary
  // text, and nothing to lean on.
  for (const guestName of ["block", "Upgrade", "NY Block"]) {
    const row = normalizeReservation(makeReservation({ guestName }), SYNCED_AT);
    assertEquals(row.is_block, false, `name ${guestName} must not affect is_block`);
  }
});

Deno.test("an unknown status is stored as it came", () => {
  // Hostaway promises to add new values, and falling over on one is not an option.
  const row = normalizeReservation(makeReservation({ status: "somethingNew" }), SYNCED_AT);
  assertEquals(row.status, "somethingNew");
  assertEquals(row.is_block, false);
});

// ---------------------------------------------------------------------------
//  Coercion
// ---------------------------------------------------------------------------

Deno.test("numbers that arrived as strings are coerced", () => {
  const row = normalizeReservation(
    makeReservation({
      id: "65289672",
      listingMapId: "495979",
      numberOfGuests: "5",
      totalPrice: "6948.40",
    }),
    SYNCED_AT,
  );

  assertEquals(row.id, 65289672);
  assertEquals(row.property_id, 495979);
  assertEquals(row.guests_count, 5);
  assertEquals(row.total_price, 6948.4);
});

Deno.test("a zero price is kept as zero, not as null", () => {
  const row = normalizeReservation(makeReservation({ totalPrice: 0 }), SYNCED_AT);
  assertEquals(row.total_price, 0);
});

Deno.test("missing optional fields give null", () => {
  const row = normalizeReservation(
    makeReservation({
      channelId: null,
      guestName: "  ",
      numberOfGuests: "",
      totalPrice: undefined,
    }),
    SYNCED_AT,
  );

  assertEquals(row.channel_id, null);
  assertEquals(row.guest_name, null);
  assertEquals(row.guests_count, null);
  assertEquals(row.total_price, null);
});

// ---------------------------------------------------------------------------
//  Checks at the boundary
// ---------------------------------------------------------------------------

Deno.test("a zero-length stay is allowed", () => {
  // Hostaway reports these for some blocks, and the schema constraint allows it.
  const row = normalizeReservation(
    makeReservation({ arrivalDate: "2026-09-10", departureDate: "2026-09-10" }),
    SYNCED_AT,
  );
  assertEquals(row.arrival_date, row.departure_date);
});

Deno.test("a departure before the arrival is rejected", () => {
  // Such a row would sink the whole batch on the constraint — stop it at the boundary.
  assertThrows(
    () =>
      normalizeReservation(
        makeReservation({ arrivalDate: "2026-09-10", departureDate: "2026-09-01" }),
        SYNCED_AT,
      ),
    Error,
    "65289672",
  );
});

Deno.test("throws on a date it cannot read", () => {
  for (const bad of ["not-a-date", "2026-13-45", "", null, 20260828]) {
    assertThrows(
      () => normalizeReservation(makeReservation({ arrivalDate: bad }), SYNCED_AT),
      Error,
      "arrivalDate",
    );
  }
});

Deno.test("throws with no usable id", () => {
  for (const bad of [null, "", "not-a-number", {}, []]) {
    assertThrows(() => normalizeReservation(makeReservation({ id: bad }), SYNCED_AT), Error, "id");
  }
});

Deno.test("throws with no listingMapId: a booking with no listing means nothing", () => {
  assertThrows(
    () => normalizeReservation(makeReservation({ listingMapId: null }), SYNCED_AT),
    Error,
    "listingMapId",
  );
});

Deno.test("throws when what arrived is not an object", () => {
  for (const bad of [null, undefined, 42, "a string", [], true]) {
    assertThrows(() => normalizeReservation(bad, SYNCED_AT), Error);
  }
});

// ---------------------------------------------------------------------------
//  Which room the booking took
// ---------------------------------------------------------------------------

/** Real shape from booking 66140823 on listing 219524, room "3 - 3008". */
function unit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 2866072,
    reservationId: 65289672,
    listingUnitId: 18008,
    guestName: "Test Guest",
    numberOfGuests: 1,
    totalPrice: 469.82,
    ...overrides,
  };
}

Deno.test("an ordinary listing names no room, and that is not a problem", () => {
  assertEquals(reservationUnits(makeReservation()), []);
});

Deno.test("reservationUnit as an empty array names no room either", () => {
  assertEquals(reservationUnits(makeReservation({ reservationUnit: [] })), []);
});

Deno.test("a booking on one room is one link", () => {
  const raw = makeReservation({ reservationUnit: [unit()] });

  assertEquals(reservationUnits(raw), [{ reservation_id: 65289672, hostaway_unit_id: 18008 }]);
});

// Eight bookings in the account take more than one room, one of them three.
// A single link would schedule one cleaning where three are needed.
Deno.test("a booking across three rooms is three links", () => {
  const raw = makeReservation({
    id: 64882623,
    reservationUnit: [
      unit({ listingUnitId: 18008 }),
      unit({ listingUnitId: 18009 }),
      unit({ listingUnitId: 18010 }),
    ],
  });

  assertEquals(reservationUnits(raw).map((link) => link.hostaway_unit_id), [18008, 18009, 18010]);
  assertEquals(reservationUnits(raw).every((link) => link.reservation_id === 64882623), true);
});

// The row id is derived from the unit number, so a reference without one has
// nowhere to go. The rest of the booking still does.
Deno.test("a room reference with no unit id is dropped, the others survive", () => {
  const raw = makeReservation({
    reservationUnit: [unit({ listingUnitId: null }), unit({ listingUnitId: 18009 })],
  });

  assertEquals(reservationUnits(raw), [{ reservation_id: 65289672, hostaway_unit_id: 18009 }]);
});

Deno.test("the same room named twice is one link", () => {
  const raw = makeReservation({ reservationUnit: [unit(), unit()] });

  assertEquals(reservationUnits(raw).length, 1);
});

// Deciding which bookings deserve a cleaning belongs to the generator, which
// already reads the status. Dropping the room here would take the fact away
// before it could.
Deno.test("the room is read whatever the status says", () => {
  for (const status of ["new", "modified", "cancelled", "inquiry", "ownerStay", "expired"]) {
    const raw = makeReservation({ status, reservationUnit: [unit()] });
    assertEquals(reservationUnits(raw).length, 1, `status ${status}`);
  }
});

// Silence is not an empty answer. An ordinary listing says `[]`; a response
// that has lost the field says nothing, and the sync must leave the links it
// already holds alone rather than read the absence as "this booking has no
// rooms" and delete them.
Deno.test("a missing reservationUnit is silence, not an empty answer", () => {
  const raw = makeReservation();
  delete raw.reservationUnit;

  assertEquals(reservationUnits(raw), [{ reservation_id: 65289672, hostaway_unit_id: null }]);
});

Deno.test("reservationUnit that is not an array is silence too", () => {
  assertEquals(
    reservationUnits(makeReservation({ reservationUnit: "nope" })),
    [{ reservation_id: 65289672, hostaway_unit_id: null }],
  );
});

Deno.test("reservationUnit as null is silence too", () => {
  assertEquals(
    reservationUnits(makeReservation({ reservationUnit: null })),
    [{ reservation_id: 65289672, hostaway_unit_id: null }],
  );
});

Deno.test("a booking with no usable id throws: there is nothing to link to", () => {
  assertThrows(
    () => reservationUnits(makeReservation({ id: null, reservationUnit: [unit()] })),
    Error,
    "id",
  );
});
