import { assert, assertEquals } from "jsr:@std/assert@1";

import { createReviewKeyer } from "./key.ts";
import {
  BOOKING_FAILURES_TO_STOP,
  PORTION_SIZE,
  type ReviewSyncStore,
  runReviewSync,
  type RunCounts,
  type StoredReview,
  syncWindowStart,
} from "./sync.ts";
import type {
  BookingFacts,
  FetchedReviews,
  NeutralReviewRow,
  ReviewSettings,
  ReviewSourceAdapter,
  RunError,
  SourceReview,
  SourceRow,
} from "./types.ts";
import { ReviewSourceError } from "./types.ts";

// Synthetic reviews, names and fakes of the database; nothing leaves the process.

const TEST_SECRET = "test-only-review-id-secret-0123456789abcdef";
const keyOf = await createReviewKeyer("hostaway", TEST_SECRET);

const SETTINGS: ReviewSettings = {
  sync_enabled: true,
  texts_enabled: true,
  tasks_enabled: false,
  model_enabled: true,
  model_since: "2026-10-01T06:00:00Z",
  daily_model_cap: 50,
  notice_published_at: "2026-09-01T00:00:00Z",
};

const NOW = new Date("2026-10-15T06:00:00Z"); // a Thursday

function source(
  id: string,
  overrides: Partial<SourceRow> = {},
  text = "No hot water. Thanks Anna! Mr Bookerson said hi.",
  guestNames: string[] = ["Anna Synthetic"],
): SourceReview {
  return {
    row: {
      external_id: id,
      external_listing_id: "700001",
      listing_id: 700001,
      room_id: null,
      external_reservation_id: "80000001",
      reservation_id: 80000001,
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
  readonly rows: readonly NeutralReviewRow[];
  readonly watermark: Date | null;
  readonly errors: readonly RunError[];
  readonly counts: RunCounts | null;
}

function syncStore(
  settings: ReviewSettings | null,
  watermark: Date | null,
  options: { buildings?: number[]; stored?: Map<string, StoredReview> } = {},
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

type Booking = BookingFacts | Error;

/** The PMS: the reviews, and a booking for each id — or an error to throw. */
function adapter(reviews: SourceReview[], bookings: Record<string, Booking> = {}) {
  const windows: Array<{ since: Date; until: Date }> = [];
  const bookingCalls: string[] = [];
  const value: ReviewSourceAdapter = {
    source: "hostaway",
    fetchPublished: (since, until): Promise<FetchedReviews> => {
      windows.push({ since, until });
      return Promise.resolve({ reviews, skipped: 0 });
    },
    bookingOf: (review) => {
      bookingCalls.push(review.row.external_id);
      const booking = bookings[review.row.external_id] ??
        { roomId: null, guestNames: ["Anna Bookerson"] };
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

Deno.test("the window: watermark minus three days, the history first, a hundred days on Sundays", () => {
  const mark = new Date("2026-10-14T06:00:00Z");
  assertEquals(syncWindowStart(mark, NOW).toISOString(), "2026-10-11T06:00:00.000Z");
  assertEquals(syncWindowStart(null, NOW).toISOString(), "2025-10-15T06:00:00.000Z");
  const sunday = new Date("2026-10-18T06:00:00Z");
  assertEquals(syncWindowStart(mark, sunday).toISOString(), "2026-07-10T06:00:00.000Z");
});

Deno.test("every row goes keyed by the HMAC of its id, and the database is asked by the keys", async () => {
  const { store, calls, asked } = syncStore({ ...SETTINGS, texts_enabled: false }, null);
  await runReviewSync({ store, adapter: adapter([source("1"), source("2")]).value, keyOf, now: () => NOW });
  const [k1, k2] = [await keyOf("1"), await keyOf("2")];
  assertEquals(calls[0].rows.map((row) => [row.external_key, row.external_id]), [[k1, "1"], [k2, "2"]]);
  assertEquals(asked, [[k1, k2]]);
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
  const late: SourceReview = {
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
  const src = adapter([source("1"), source("2")], { "1": new Error("Hostaway returned HTTP 503") });
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

Deno.test("past its days of waiting a review goes with its own names, or without its text when it has none", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const old = { submitted_at: "2026-10-01T09:00:00Z", arrival_date: "2026-09-20" };
  const src = adapter([
    source("own", old),
    source("none", old, "Lovely, thanks!", []),
  ], { own: new Error("down"), none: new Error("down") });
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
  const noBooking = { reservation_id: null, external_reservation_id: null };
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
  const failing = Object.fromEntries(["1", "2", "3", "4"].map((id) => [id, new Error("down")]));
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
    junk: { roomId: null, guestNames: ["?"] },
  });
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  assertEquals(calls[0].rows[0].public_text, undefined);
  assertEquals(summary.textsWithoutNames, 1);
  assertEquals(summary.withTexts, 0);
});

Deno.test("a review with a rating and no text asks no booking and never waits", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const bare: SourceReview = {
    ...source("bare", { has_public_text: false }),
    texts: { publicText: null, privateText: null, categoryComments: {} },
  };
  const src = adapter([bare], { bare: new Error("down") });
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });
  assertEquals(src.bookingCalls, []);
  assertEquals(calls[0].rows.map((row) => row.external_id), ["bare"]);
  assertEquals([summary.heldForNames, summary.textsWithoutNames, summary.readAgain], [0, 0, false]);
});

Deno.test("only failures in a row stop the reads, and the stop has its own code", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const src = adapter(["1", "2", "3", "4", "5"].map((id) => source(id)), {
    "1": new Error("down"),
    "3": new Error("down"),
    "4": new Error("down"),
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

Deno.test("behind the ceiling an old review waits too: its booking is there, the run ran out of reads", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const old = { submitted_at: "2026-09-20T09:00:00Z", arrival_date: "2026-09-10" };
  const src = adapter([source("1"), source("old", old)]);
  const summary = await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW, maxBookingLookups: 1 });
  assertEquals(calls[0].rows.map((row) => row.external_id), ["1"]);
  assertEquals(summary.heldForNames, 1);
  assertEquals(calls[0].watermark, null);
});

Deno.test("a room is asked only while a building's stay is exact and its room unknown", async () => {
  const known = new Map([[await keyOf("known"), { ...FULL_STORED, roomKnown: true }]]);
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"), {
    buildings: [700001],
    stored: known,
  });
  const src = adapter([source("new"), source("known"), source("before", { arrival_date: "2026-08-01" })], {
    new: { roomId: 1000000061011, guestNames: [] },
  });
  await runReviewSync({ store, adapter: src.value, keyOf, now: () => NOW });

  assertEquals(src.bookingCalls, ["new"]);
  assertEquals(calls[0].rows[0].room_id, 1000000061011);
  assertEquals(calls[0].rows[1].room_id, null);
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

Deno.test("a source that fails journals its code and moves nothing", async () => {
  const { store, calls } = syncStore(SETTINGS, null);
  const failing: ReviewSourceAdapter = {
    source: "hostaway",
    fetchPublished: () => Promise.reject(new ReviewSourceError("source_filter_ignored", "x")),
    bookingOf: () => Promise.resolve({ roomId: null, guestNames: [] }),
  };
  const summary = await runReviewSync({ store, adapter: failing, keyOf, now: () => NOW });
  assertEquals(summary.status, "failed");
  assertEquals(calls, [{
    rows: [],
    watermark: null,
    errors: [{ code: "source_filter_ignored", count: 1 }],
    counts: null,
  }]);
});

Deno.test("the guest's names reach no row, no journal, no summary and no log — not even through an error", async () => {
  const names = ["Kateřina", "Dvořáková", "Bookerson"];
  const logged: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const keep = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  Object.assign(console, { log: keep, info: keep, warn: keep, error: keep, debug: keep });
  try {
    const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"), { buildings: [700001] });
    const reviews = [
      source("1", {}, "Kateřino, díky! Dvořákové se líbilo.", ["Kateřina Dvořáková"]),
      source("2", {}, "Bookersonová says the tap leaks.", []),
      source("3", { submitted_at: "2026-10-01T09:00:00Z" }, "Dvorakova was here.", ["Kateřina Dvořáková"]),
    ];
    const src = adapter(reviews, {
      "1": new Error("Hostaway rejected request reservations/1: guest Kateřina Dvořáková"),
      "2": { roomId: null, guestNames: ["Anna Bookerson"] },
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
