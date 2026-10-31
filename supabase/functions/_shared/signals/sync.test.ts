import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  type FetchedReviews,
  type GuestSignalAdapter,
  type NamesResult,
  type NeutralReview,
  type NeutralReviewRow,
  SignalSourceError,
  type TimeWindow,
} from "./adapter.ts";
import { FAKE_CAPABILITIES } from "./fake-pms.ts";
import { createSignalKeyer } from "./key.ts";
import {
  BOOKING_FAILURES_TO_STOP,
  PORTION_SIZE,
  type ReviewIngestRow,
  type ReviewSyncStore,
  runReviewSync,
  type RunCounts,
  type StoredReview,
  syncWindowStart,
} from "./sync.ts";
import type { RunError, SignalSettings } from "./types.ts";

// Synthetic reviews, names and fakes of the database and the PMS; nothing
// leaves the process. The ids are not Hostaway's on purpose: the core takes
// any PMS's ids as opaque strings.

const TEST_SECRET = "test-only-signal-key-secret-0123456789abcdef";
const keyOf = await createSignalKeyer("fake", "review", TEST_SECRET);

const SETTINGS: SignalSettings = {
  sync_enabled: true,
  texts_enabled: true,
  tasks_enabled: false,
  model_enabled: true,
  model_since: "2026-10-01T06:00:00Z",
  daily_model_cap: 50,
  notice_published_at: "2026-09-01T00:00:00Z",
};

const NOW = new Date("2026-10-15T06:00:00Z"); // a Thursday

/** A review's booking id in these tests: "booking-<review id>". */
function bookingOf(id: string): string {
  return `booking-${id}`;
}

function source(
  id: string,
  overrides: Partial<NeutralReviewRow> = {},
  text = "No hot water. Thanks Anna! Mr Bookerson said hi.",
  guestNames: string[] = ["Anna Synthetic"],
): NeutralReview {
  return {
    row: {
      external_id: id,
      external_listing_id: "listing-1",
      external_unit_id: null,
      external_reservation_id: bookingOf(id),
      channel: "airbnb",
      rating: 6,
      category_ratings: {},
      arrival_date: "2026-10-10",
      departure_date: "2026-10-13",
      submitted_at: "2026-10-14T09:00:00Z",
      is_hidden: false,
      has_public_text: true,
      has_private_text: false,
      has_host_reply: false,
      external_updated_at: null,
      ...overrides,
    },
    texts: { publicText: text, privateText: null, categoryComments: {} },
    guestNames,
    listingNames: ["Test Flat A"],
  };
}

interface IngestCall {
  readonly rows: readonly ReviewIngestRow[];
  readonly watermark: Date | null;
  readonly errors: readonly RunError[];
  readonly counts: RunCounts | null;
}

function syncStore(
  settings: SignalSettings | null,
  watermark: Date | null,
  options: { buildings?: string[]; stored?: Map<string, StoredReview> } = {},
) {
  const calls: IngestCall[] = [];
  const asked: string[][] = [];
  const store: ReviewSyncStore = {
    settings: () => Promise.resolve(settings),
    watermark: () => Promise.resolve(watermark),
    buildings: () => Promise.resolve(new Set(options.buildings ?? [])),
    redactionNames: () => Promise.resolve({ staff: ["Olga Staff"], places: ["Our Flat"] }),
    loadState: (keys) => {
      asked.push([...keys]);
      return Promise.resolve(options.stored ?? new Map());
    },
    ingest: (rows, mark, errors, counts) => {
      calls.push({ rows, watermark: mark, errors, counts });
      return Promise.resolve({ inserted: rows.length, updated: 0, cut: 0, journal_written: true });
    },
  };
  return { store, calls, asked };
}

/** What namesOf answers for a review (by its id), or an error it throws against its contract. */
type Booking = NamesResult | Error;

const NAMED: NamesResult = { status: "ok", names: ["Anna Bookerson"], externalUnitId: null };
const DOWN: NamesResult = { status: "unavailable" };

/** The PMS: the reviews, and the booking of each review by its id. */
function adapter(reviews: NeutralReview[], bookings: Record<string, Booking> = {}) {
  const windows: TimeWindow[] = [];
  const bookingCalls: string[] = [];
  const value: GuestSignalAdapter = {
    provider: "fake",
    capabilities: FAKE_CAPABILITIES,
    fetchReviews: (window): Promise<FetchedReviews> => {
      windows.push(window);
      return Promise.resolve({ reviews, skipped: 0 });
    },
    namesOf: (reservationId) => {
      const id = reservationId.replace(/^booking-/, "");
      bookingCalls.push(id);
      const booking = bookings[id] ?? NAMED;
      return booking instanceof Error ? Promise.reject(booking) : Promise.resolve(booking);
    },
  };
  return { value, windows, bookingCalls };
}

const FULL_STORED: StoredReview = {
  publicKept: true,
  privateKept: false,
  commentsKept: false,
  textAllowed: true,
  stayExact: true,
  roomKnown: false,
};

Deno.test("sync does nothing while the company has not switched it on", async () => {
  const { store, calls } = syncStore({ ...SETTINGS, sync_enabled: false }, null);
  const src = adapter([]);
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  assertEquals(summary.status, "off");
  assertEquals(src.windows.length, 0);
  assertEquals(calls.length, 0);
});

Deno.test("a PMS without reviews: nothing to read, nothing journaled", async () => {
  const { store, calls } = syncStore(SETTINGS, null);
  const messagesOnly: GuestSignalAdapter = {
    provider: "fake",
    capabilities: { ...FAKE_CAPABILITIES, reviews: false },
    namesOf: () => Promise.resolve(NAMED),
  };
  const summary = await runReviewSync({ store, adapter: messagesOnly, keyOf, now: () => NOW });
  assertEquals(summary.status, "unsupported");
  assertEquals(calls.length, 0);
});

Deno.test("the window: watermark minus three days, the history first, a hundred days on Sundays", () => {
  const mark = new Date("2026-10-14T06:00:00Z");
  assertEquals(syncWindowStart(mark, NOW).toISOString(), "2026-10-11T06:00:00.000Z");
  assertEquals(syncWindowStart(null, NOW).toISOString(), "2025-10-15T06:00:00.000Z");
  const sunday = new Date("2026-10-18T06:00:00Z");
  assertEquals(syncWindowStart(mark, sunday).toISOString(), "2026-07-10T06:00:00.000Z");
});

Deno.test("the adapter is asked for the window from its start up to now", async () => {
  const { store } = syncStore(SETTINGS, new Date("2026-10-14T06:00:00Z"));
  const src = adapter([]);
  await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  assertEquals(src.windows, [{ since: new Date("2026-10-11T06:00:00Z"), until: NOW }]);
});

Deno.test("every row goes keyed by the HMAC of its id, with the PMS's ids only; the database is asked by the keys", async () => {
  const { store, calls, asked } = syncStore({ ...SETTINGS, texts_enabled: false }, null);
  await runReviewSync({ store, adapter: adapter([source("1"), source("2")]).value, keyOf, now: () => NOW });
  const [k1, k2] = [await keyOf("1"), await keyOf("2")];
  assertEquals(calls[0].rows.map((row) => [row.external_key, row.external_id]), [[k1, "1"], [k2, "2"]]);
  assertEquals(asked, [[k1, k2]]);
  const [row] = calls[0].rows;
  assertEquals([row.external_listing_id, row.external_unit_id, row.external_reservation_id], [
    "listing-1",
    null,
    "booking-1",
  ]);
  for (const ours of ["listing_id", "room_id", "reservation_id"]) {
    assert(!(ours in row), `the row carries our ${ours}`);
  }
});

Deno.test("texts go redacted with the names of the review and of its booking; a hidden one sends none", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const src = adapter([source("1"), source("2", { is_hidden: true })]);
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });

  const [only] = calls;
  assertEquals(only.watermark, NOW);
  const [shown, hidden] = only.rows;
  // "Anna" from the review, "Bookerson" only from the booking.
  assertEquals(shown.public_text, "No hot water. Thanks [GUEST]! Mr [GUEST] said hi.");
  assertEquals(hidden.public_text, undefined);
  assertEquals(src.bookingCalls, ["1"]);
  assertEquals(summary.withTexts, 1);
  assertEquals(only.counts?.booking_lookups, 1);
});

Deno.test("texts off: ratings only, nothing of the text leaves, no booking asked", async () => {
  const { store, calls } = syncStore({ ...SETTINGS, texts_enabled: false }, null);
  const src = adapter([source("1")]);
  await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  assertEquals(calls[0].rows[0].public_text, undefined);
  assertEquals(src.bookingCalls, []);
});

Deno.test("a text the database already keeps is not sent again and asks no booking; a late part is", async () => {
  const kept = new Map([[await keyOf("1"), FULL_STORED], [await keyOf("2"), FULL_STORED]]);
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"), { stored: kept });
  const late: NeutralReview = {
    ...source("2"),
    texts: { publicText: "Fine.", privateText: "Anna here: the boiler blinked.", categoryComments: {} },
  };
  const src = adapter([source("1"), late]);
  await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });

  assertEquals(src.bookingCalls, ["2"]);
  assertEquals(calls[0].rows[0].public_text, undefined);
  assertEquals(calls[0].rows[1].private_text, "[GUEST] here: the boiler blinked.");
});

Deno.test("a fresh review whose booking cannot be read waits whole, and the window is read again", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const src = adapter([source("1"), source("2")], { "1": DOWN });
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });

  assertEquals(calls[0].rows.map((row) => row.external_id), ["2"]);
  assertEquals(calls[0].watermark, null);
  assertEquals(summary.readAgain, true);
  assertEquals(summary.heldForNames, 1);
  assertEquals(calls[0].errors, [
    { code: "booking_lookup_failed", count: 1 },
    { code: "review_held_for_names", count: 1 },
  ]);
});

Deno.test("an adapter that throws from namesOf against its contract is a failure like any other", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const src = adapter([source("1")], { "1": new Error("PMS answered HTTP 503") });
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  assertEquals(summary.heldForNames, 1);
  assertEquals(calls[0].errors[0], { code: "booking_lookup_failed", count: 1 });
});

Deno.test("a booking the PMS no longer has is gone, not failing: the review goes at once with its own names", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"), { buildings: ["listing-1"] });
  const src = adapter([source("gone"), source("next")], { gone: { status: "gone" }, next: DOWN });
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });

  const [gone] = calls[0].rows;
  assertEquals(gone.external_id, "gone");
  assertEquals(gone.public_text, "No hot water. Thanks [GUEST]! Mr Bookerson said hi.");
  assertEquals(gone.external_unit_id, null);
  assertEquals(summary.heldForNames, 1, "only the review behind a failure waits");
  assertEquals(calls[0].errors, [
    { code: "booking_lookup_failed", count: 1 },
    { code: "review_held_for_names", count: 1 },
  ]);
});

Deno.test("past its days of waiting a review goes with its own names, or without its text when it has none", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const old = { submitted_at: "2026-10-01T09:00:00Z", arrival_date: "2026-09-20" };
  const src = adapter([
    source("own", old),
    source("none", old, "Lovely, thanks!", []),
  ], { own: DOWN, none: DOWN });
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });

  const [own, none] = calls[0].rows;
  assertEquals(own.public_text, "No hot water. Thanks [GUEST]! Mr Bookerson said hi.");
  assertEquals(none.public_text, undefined);
  assertEquals(summary.textsWithoutNames, 1);
  assertEquals(calls[0].counts?.texts_without_names, 1);
  assertEquals(calls[0].watermark, NOW, "nothing waits: the watermark moves");
});

Deno.test("a review without a booking or any name keeps no text; with its own name it is redacted", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const noBooking = { external_reservation_id: null };
  const src = adapter([
    source("named", noBooking),
    source("anonymous", noBooking, "Thanks, all good.", []),
  ]);
  await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });

  assertEquals(src.bookingCalls, []);
  assertEquals(calls[0].rows[0].public_text, "No hot water. Thanks [GUEST]! Mr Bookerson said hi.");
  assertEquals(calls[0].rows[1].public_text, undefined);
});

Deno.test("the PMS failing twice stops the booking reads for the run; a ceiling bounds them too", async () => {
  const failing = Object.fromEntries(["1", "2", "3", "4"].map((id) => [id, DOWN]));
  const run1 = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const src1 = adapter(["1", "2", "3", "4"].map((id) => source(id)), failing);
  const stopped = await runReviewSync({ store: run1.store, adapter: src1.value, keyOf, now: () => NOW });
  assertEquals(src1.bookingCalls.length, BOOKING_FAILURES_TO_STOP);
  assertEquals(stopped.heldForNames, 4);
  assertEquals(run1.calls[0].rows, []);

  const run2 = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const src2 = adapter(["1", "2", "3"].map((id) => source(id)));
  const capped = await runReviewSync({
    store: run2.store,
    adapter: src2.value,
    keyOf,
    now: () => NOW,
    maxBookingLookups: 2,
  });
  assertEquals(src2.bookingCalls, ["1", "2"]);
  assertEquals(capped.heldForNames, 1);
  assertEquals(run2.calls[0].errors, [
    { code: "booking_lookup_capped", count: 1 },
    { code: "review_held_for_names", count: 1 },
  ]);
});

Deno.test("a name of no letters is no name: the text does not go as if redacted", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const src = adapter([source("junk", {}, "Kettle broken, Kateřina.", ["-"])], {
    junk: { status: "ok", names: ["?"], externalUnitId: null },
  });
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  assertEquals(calls[0].rows[0].public_text, undefined);
  assertEquals(summary.textsWithoutNames, 1);
  assertEquals(summary.withTexts, 0);
});

Deno.test("a review with a rating and no text asks no booking and never waits", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const bare: NeutralReview = {
    ...source("bare", { has_public_text: false }),
    texts: { publicText: null, privateText: null, categoryComments: {} },
  };
  const src = adapter([bare], { bare: DOWN });
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  assertEquals(src.bookingCalls, []);
  assertEquals(calls[0].rows.map((row) => row.external_id), ["bare"]);
  assertEquals([summary.heldForNames, summary.textsWithoutNames, summary.readAgain], [0, 0, false]);
});

Deno.test("only failures in a row stop the reads, and the stop has its own code", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const src = adapter(["1", "2", "3", "4", "5"].map((id) => source(id)), {
    "1": DOWN,
    "3": DOWN,
    "4": DOWN,
  });
  await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  // 1 fails, 2 reads (the count starts again), 3 and 4 fail, 5 is not asked.
  assertEquals(src.bookingCalls, ["1", "2", "3", "4"]);
  assertEquals(calls[0].errors, [
    { code: "booking_lookup_failed", count: 3 },
    { code: "booking_lookups_stopped", count: 1 },
    { code: "review_held_for_names", count: 4 },
  ]);
});

Deno.test("a booking that is gone starts the count of failures again, as a read does", async () => {
  const { store } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const src = adapter(["1", "2", "3", "4"].map((id) => source(id)), {
    "1": DOWN,
    "2": { status: "gone" },
    "3": DOWN,
  });
  await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  assertEquals(src.bookingCalls, ["1", "2", "3", "4"]);
});

Deno.test("behind the ceiling an old review waits too: its booking is there, the run ran out of reads", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const old = { submitted_at: "2026-09-20T09:00:00Z", arrival_date: "2026-09-10" };
  const src = adapter([source("1"), source("old", old)]);
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW, maxBookingLookups: 1 });
  assertEquals(calls[0].rows.map((row) => row.external_id), ["1"]);
  assertEquals(summary.heldForNames, 1);
  assertEquals(calls[0].watermark, null);
});

Deno.test("a room is asked only while a building's stay is exact and its room unknown; it goes as the PMS's id", async () => {
  const known = new Map([[await keyOf("known"), { ...FULL_STORED, roomKnown: true }]]);
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"), {
    buildings: ["listing-1"],
    stored: known,
  });
  const src = adapter([source("new"), source("known"), source("before", { arrival_date: "2026-08-01" })], {
    new: { status: "ok", names: [], externalUnitId: "unit-61011" },
  });
  await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });

  assertEquals(src.bookingCalls, ["new"]);
  assertEquals(calls[0].rows[0].external_unit_id, "unit-61011");
  assertEquals(calls[0].rows[1].external_unit_id, null);
});

Deno.test("a listing that is not a building asks no room, whatever its text", async () => {
  const { store, calls } = syncStore({ ...SETTINGS, texts_enabled: false }, null, { buildings: ["listing-2"] });
  const src = adapter([source("1")], { "1": { status: "ok", names: [], externalUnitId: "unit-1" } });
  await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  assertEquals(src.bookingCalls, []);
  assertEquals(calls[0].rows[0].external_unit_id, null);
});

Deno.test("only the last portion moves the watermark and carries the errors and the counts", async () => {
  const { store, calls } = syncStore({ ...SETTINGS, texts_enabled: false }, null);
  const many = Array.from({ length: PORTION_SIZE + 3 }, (_, i) => source(String(i)));
  const summary = await runReviewSync({ store, adapter: adapter(many).value, keyOf, now: () => NOW });
  assertEquals(calls.map((c) => [c.rows.length, c.watermark, c.counts === null]), [
    [PORTION_SIZE, null, true],
    [3, NOW, false],
  ]);
  assertEquals(summary.inserted, PORTION_SIZE + 3);
});

Deno.test("a source that fails journals source_<its code> and moves nothing; an unknown failure is source_unavailable", async () => {
  for (
    const [thrown, code] of [
      [new SignalSourceError("filter_ignored", "x"), "source_filter_ignored"],
      [new SignalSourceError("rate_limited", "x"), "source_rate_limited"],
      [new TypeError("x"), "source_unavailable"],
    ] as const
  ) {
    const { store, calls } = syncStore(SETTINGS, null);
    const failing: GuestSignalAdapter = {
      provider: "fake",
      capabilities: FAKE_CAPABILITIES,
      fetchReviews: () => Promise.reject(thrown),
      namesOf: () => Promise.resolve(NAMED),
    };
    const summary = await runReviewSync({ store, adapter: failing, keyOf, now: () => NOW });
    assertEquals(summary.status, "failed");
    assertEquals(summary.readAgain, true);
    assertEquals(calls, [{ rows: [], watermark: null, errors: [{ code, count: 1 }], counts: null }]);
  }
});

Deno.test("rows the PMS sent broken are journaled as source_bad_row", async () => {
  const { store, calls } = syncStore(SETTINGS, null);
  const src: GuestSignalAdapter = {
    provider: "fake",
    capabilities: FAKE_CAPABILITIES,
    fetchReviews: () => Promise.resolve({ reviews: [], skipped: 2 }),
    namesOf: () => Promise.resolve(NAMED),
  };
  await runReviewSync({ store, adapter: src, keyOf, now: () => NOW });
  assertEquals(calls[0].errors, [{ code: "source_bad_row", count: 2 }]);
});

Deno.test("the guest's names reach no row, no journal, no summary and no log — not even through an error", async () => {
  const names = ["Kateřina", "Dvořáková", "Bookerson"];
  const logged: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const keep = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  Object.assign(console, { log: keep, info: keep, warn: keep, error: keep, debug: keep });
  try {
    const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"), { buildings: ["listing-1"] });
    const reviews = [
      source("1", {}, "Kateřino, díky! Dvořákové se líbilo.", ["Kateřina Dvořáková"]),
      source("2", {}, "Bookersonová says the tap leaks.", []),
      source("3", { submitted_at: "2026-10-01T09:00:00Z" }, "Dvorakova was here.", ["Kateřina Dvořáková"]),
    ];
    const src = adapter(reviews, {
      "1": new Error("PMS rejected request reservations/1: guest Kateřina Dvořáková"),
      "2": { status: "ok", names: ["Anna Bookerson"], externalUnitId: null },
      "3": new Error("Kateřina Dvořáková"),
    });
    const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });

    const everything = JSON.stringify({ calls, summary, logged });
    for (const name of [...names, "Dvorakov", "Kateřin"]) {
      assert(!everything.includes(name), `"${name}" left the function`);
    }
    assertEquals(summary.heldForNames, 1);
  } finally {
    Object.assign(console, saved);
  }
});
