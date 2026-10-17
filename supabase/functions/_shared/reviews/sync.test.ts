import { assert, assertEquals } from "jsr:@std/assert@1";

import { PORTION_SIZE, type ReviewSyncStore, runReviewSync, syncWindowStart } from "./sync.ts";
import type {
  FetchedReviews,
  NeutralReviewRow,
  ReviewSettings,
  ReviewSourceAdapter,
  RunError,
  SourceReview,
} from "./types.ts";
import { ReviewSourceError } from "./types.ts";

// Synthetic reviews and fakes of the database; nothing leaves the process.

const SETTINGS: ReviewSettings = {
  sync_enabled: true,
  texts_enabled: true,
  tasks_enabled: false,
  model_enabled: true,
  daily_model_cap: 50,
  notice_published_at: "2026-09-01T00:00:00Z",
};

const NOW = new Date("2026-10-15T06:00:00Z"); // a Thursday

function source(id: string, overrides: Partial<NeutralReviewRow> = {}, text = "No hot water. Thanks Anna!"): SourceReview {
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
    guestNames: ["Anna Synthetic"],
    listingNames: ["Test Flat A"],
  };
}

interface IngestCall {
  readonly rows: readonly NeutralReviewRow[];
  readonly watermark: Date | null;
  readonly errors: readonly RunError[];
}

function syncStore(settings: ReviewSettings | null, watermark: Date | null, buildings: number[] = []) {
  const calls: IngestCall[] = [];
  const store: ReviewSyncStore = {
    settings: () => Promise.resolve(settings),
    watermark: () => Promise.resolve(watermark),
    buildings: () => Promise.resolve(new Set(buildings)),
    redactionNames: () => Promise.resolve({ staff: ["Olga Staff"], places: ["Our Flat"] }),
    ingest: (rows, mark, errors) => {
      calls.push({ rows, watermark: mark, errors });
      return Promise.resolve({ inserted: rows.length, updated: 0, cut: 0, journal_written: true });
    },
  };
  return { store, calls };
}

function adapter(reviews: SourceReview[], rooms: Record<string, number | null> = {}) {
  const asked: Array<{ since: Date; until: Date }> = [];
  const roomCalls: string[] = [];
  const value: ReviewSourceAdapter = {
    source: "hostaway",
    fetchPublished: (since, until): Promise<FetchedReviews> => {
      asked.push({ since, until });
      return Promise.resolve({ reviews, skipped: 0 });
    },
    roomOf: (review) => {
      roomCalls.push(review.row.external_id);
      return Promise.resolve(rooms[review.row.external_id] ?? null);
    },
  };
  return { value, asked, roomCalls };
}

Deno.test("sync does nothing while the company has not switched it on", async () => {
  const { store, calls } = syncStore({ ...SETTINGS, sync_enabled: false }, null);
  const src = adapter([]);
  const summary = await runReviewSync({ store, adapter: src.value, now: () => NOW });
  assertEquals(summary.status, "off");
  assertEquals(src.asked.length, 0);
  assertEquals(calls.length, 0);
});

Deno.test("the window: watermark minus three days, the history first, a hundred days on Sundays", () => {
  const mark = new Date("2026-10-14T06:00:00Z");
  assertEquals(syncWindowStart(mark, NOW).toISOString(), "2026-10-11T06:00:00.000Z");
  assertEquals(syncWindowStart(null, NOW).toISOString(), "2025-10-15T06:00:00.000Z");
  const sunday = new Date("2026-10-18T06:00:00Z");
  assertEquals(syncWindowStart(mark, sunday).toISOString(), "2026-07-10T06:00:00.000Z");
});

Deno.test("texts go only redacted, never a name; a hidden review sends no text", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"));
  const src = adapter([source("1"), source("2", { is_hidden: true })]);
  await runReviewSync({ store, adapter: src.value, now: () => NOW });

  const [only] = calls;
  assertEquals(only.watermark, NOW);
  const [shown, hidden] = only.rows;
  // The name thanked is the guest's own: the guest's names from the PMS go first.
  assertEquals(shown.public_text, "No hot water. Thanks [GUEST]!");
  assert(!JSON.stringify(only.rows).includes("Anna"), "a guest name left the function");
  assertEquals(hidden.public_text, undefined);
});

Deno.test("texts off: ratings only, nothing of the text leaves", async () => {
  const { store, calls } = syncStore({ ...SETTINGS, texts_enabled: false }, null);
  await runReviewSync({ store, adapter: adapter([source("1")]).value, now: () => NOW });
  assertEquals(calls[0].rows[0].public_text, undefined);
});

Deno.test("a room is asked only for a building's review whose text may be kept, and at most so many", async () => {
  const { store, calls } = syncStore(SETTINGS, new Date("2026-10-14T00:00:00Z"), [700001]);
  const before = source("old", { arrival_date: "2026-08-01" });
  const source3 = adapter([source("1"), source("2"), source("3"), before], { "1": 1000000061011 });
  const summary = await runReviewSync({
    store,
    adapter: source3.value,
    now: () => NOW,
    maxRoomLookups: 2,
  });

  assertEquals(source3.roomCalls, ["1", "2"]);
  assertEquals(calls[0].rows[0].room_id, 1000000061011);
  assertEquals(summary.errors, [{ code: "room_lookup_capped", count: 1 }]);
});

Deno.test("only the last portion moves the watermark and carries the errors", async () => {
  const { store, calls } = syncStore({ ...SETTINGS, texts_enabled: false }, null);
  const many = Array.from({ length: PORTION_SIZE + 3 }, (_, i) => source(String(i)));
  const summary = await runReviewSync({ store, adapter: adapter(many).value, now: () => NOW });
  assertEquals(calls.map((c) => [c.rows.length, c.watermark]), [[PORTION_SIZE, null], [3, NOW]]);
  assertEquals(summary.inserted, PORTION_SIZE + 3);
});

Deno.test("a source that fails journals its code and moves nothing", async () => {
  const { store, calls } = syncStore(SETTINGS, null);
  const failing: ReviewSourceAdapter = {
    source: "hostaway",
    fetchPublished: () => Promise.reject(new ReviewSourceError("source_filter_ignored", "x")),
    roomOf: () => Promise.resolve(null),
  };
  const summary = await runReviewSync({ store, adapter: failing, now: () => NOW });
  assertEquals(summary.status, "failed");
  assertEquals(calls, [{ rows: [], watermark: null, errors: [{ code: "source_filter_ignored", count: 1 }] }]);
});
