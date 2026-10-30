import { assert, assertEquals } from "jsr:@std/assert@1";

import { AnthropicModelClient } from "./classify.ts";
import { type QueuedReview, runReviewClassify } from "./classify-run.ts";
import { createReviewKeyer } from "./key.ts";
import { type ReviewSyncStore, runReviewSync } from "./sync.ts";
import type { NeutralReviewRow, ReviewSettings, ReviewSourceAdapter, SourceReview } from "./types.ts";

// The whole way of a text, with synthetic names (the owner's decision of
// 2026-10-18): the review and its booking name the guest; the load strips the
// names before anything leaves; what the database would hold is what the
// model is sent. The model's network is a fake that records every request.

const NOW = new Date("2026-10-15T06:00:00Z");
const SETTINGS: ReviewSettings = {
  sync_enabled: true,
  texts_enabled: true,
  tasks_enabled: false,
  model_enabled: true,
  model_since: "2026-10-01T06:00:00Z",
  daily_model_cap: 50,
  notice_published_at: "2026-09-01T00:00:00Z",
};
/** In the review, in its booking, in the text — in every case the text uses. */
const NAMES = ["Kateřina", "Kateřino", "Dvořáková", "Dvořákové", "Dvorakova", "Bookerson", "Bookersonová"];

const REVIEW: SourceReview = {
  row: {
    external_id: "90000001",
    external_listing_id: "700001",
    listing_id: 700001,
    room_id: null,
    external_reservation_id: "80000001",
    reservation_id: 80000001,
    channel: "booking",
    rating: 5,
    category_ratings: { cleanliness: 6 },
    arrival_date: "2026-10-10",
    departure_date: "2026-10-13",
    submitted_at: "2026-10-14T09:00:00Z",
    is_hidden: false,
    has_public_text: true,
    has_private_text: true,
    has_host_reply: false,
    external_updated_at: null,
  },
  texts: {
    publicText: "Kateřino, díky! The kettle did not work. Dvořákové se líbilo, Dvorakova was happy.",
    privateText: "Mrs Bookersonová found the shower drain blocked.",
    categoryComments: { cleanliness: "Kateřina says: dust under the bed." },
  },
  guestNames: ["Kateřina Dvořáková"],
  listingNames: ["Test Flat A"],
};

const ADAPTER: ReviewSourceAdapter = {
  source: "hostaway",
  fetchPublished: () => Promise.resolve({ reviews: [REVIEW], skipped: 0 }),
  bookingOf: () => Promise.resolve({ roomId: null, guestNames: ["Kateřina Bookerson", "Bookerson"] }),
};

function captureStore(): { store: ReviewSyncStore; rows: NeutralReviewRow[] } {
  const rows: NeutralReviewRow[] = [];
  const store: ReviewSyncStore = {
    settings: () => Promise.resolve(SETTINGS),
    watermark: () => Promise.resolve(new Date("2026-10-14T00:00:00Z")),
    buildings: () => Promise.resolve(new Set()),
    redactionNames: () => Promise.resolve({ staff: [], places: [] }),
    loadState: () => Promise.resolve(new Map()),
    ingest: (part) => {
      rows.push(...part);
      return Promise.resolve({ inserted: part.length, updated: 0, cut: 0, journal_written: true });
    },
  };
  return { store, rows };
}

/** The row as the database would hand it to classify-reviews. */
function queuedOf(row: NeutralReviewRow): QueuedReview {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    channel: row.channel,
    departure_date: row.departure_date,
    room_id: row.room_id,
    rating: row.rating,
    category_ratings: row.category_ratings,
    public_text: row.public_text ?? null,
    private_text: row.private_text ?? null,
    category_comments: row.category_comments ?? null,
    rules_version: null,
    analysed_at: null,
    analysis_attempts: 0,
    submitted_at: row.submitted_at,
  };
}

Deno.test("a guest's name reaches neither the database nor the model, in any of its forms", async () => {
  const { store, rows } = captureStore();
  const keyOf = await createReviewKeyer("hostaway", "test-only-review-id-secret-0123456789abcdef");
  await runReviewSync({ store, adapter: ADAPTER, keyOf, now: () => NOW });

  assertEquals(rows.length, 1);
  const stored = JSON.stringify(rows);
  for (const name of NAMES) {
    assert(!stored.includes(name), `"${name}" would be stored`);
  }
  assert(stored.includes("The kettle did not work"), "the rest of the text is kept");

  const requests: string[] = [];
  const fakeFetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push(String(init?.body ?? ""));
    const answer = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [{ type: "text", text: JSON.stringify({ language: "en", findings: [] }) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    return Promise.resolve(
      new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } }),
    );
  };
  const model = new AnthropicModelClient("sk-test", { fetch: fakeFetch as typeof fetch, maxRetries: 0 });
  const classifyStore = {
    settings: () => Promise.resolve(SETTINGS),
    queue: () => Promise.resolve([queuedOf(rows[0])]),
    reserveCalls: (wanted: number) => Promise.resolve(wanted),
    apply: () => Promise.resolve({}),
    markFailed: () => Promise.resolve(),
    forbiddenWords: () => Promise.resolve([]),
    log: () => Promise.resolve(),
  };
  const summary = await runReviewClassify({ store: classifyStore, model });

  assertEquals(summary.modelRead, 1);
  assertEquals(requests.length, 1);
  for (const name of NAMES) {
    assert(!requests[0].includes(name), `"${name}" was sent to the model`);
  }
  assert(requests[0].includes("[GUEST]"), "the model sees where a name was");
});
