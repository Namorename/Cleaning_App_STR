import { assert, assertEquals } from "jsr:@std/assert@1";

import { type NeutralReview, SignalSourceError, type TimeWindow } from "./adapter.ts";
import { ModelError } from "./classify.ts";
import { checkHistoryContract } from "./history-contract.ts";
import {
  type HistoryFactRow,
  type HistoryGrant,
  type HistoryState,
  type HistoryStore,
  monthRows,
  type MonthStayRow,
  runHistory,
  selectReviews,
} from "./history-run.ts";
import type { HistorySource, NeutralStayFact } from "./history-source.ts";
import { type ThemeInput, type ThemeModelClient, type ThemeReading, WORST_CALL_MICRO_USD } from "./themes-read.ts";

// A fake PMS, database and model: synthetic words, nothing leaves the process.

const NOW = new Date("2026-11-06T08:00:00Z");
/** A listing the company archived or never held. */
const UNREADABLE = new Set(["999"]);
const WEEK = "2026-09-28";

const STATE: HistoryState = {
  enabled: true,
  depth_months: 12,
  include_private: false,
  follow: false,
  daily_cap: 1500,
  budget_micro_usd: 5_000_000,
  min_confidence: 0.6,
  spent_micro_usd: 0,
  calls_today: 0,
  line: "2026-11-04",
  reviews_done: [],
  reviews_stuck: {},
  // Every month read today: a test about reviews reads no stays.
  stays_done: Object.fromEntries(
    Array.from({ length: 12 }, (_, back) => {
      const at = new Date(Date.UTC(2026, 10 - back, 1)).toISOString().slice(0, 10);
      return [at, "2026-11-06T07:00:00Z"];
    }),
  ),
};

function review(id: string, over: Partial<NeutralReview["row"]> = {}, texts: Partial<NeutralReview["texts"]> = {}): NeutralReview {
  return {
    row: {
      external_id: id,
      external_listing_id: "100",
      external_unit_id: null,
      external_reservation_id: `r${id}`,
      channel: "airbnb",
      rating: 6,
      category_ratings: {},
      arrival_date: "2026-09-28",
      departure_date: "2026-10-01",
      submitted_at: "2026-10-02T10:00:00Z",
      is_hidden: false,
      has_public_text: true,
      has_private_text: true,
      has_host_reply: false,
      external_updated_at: null,
      ...over,
    },
    texts: {
      publicText: "Zuzana says the wifi kept dropping at Synthetic Loft.",
      privateText: "Private: the sofa is broken.",
      categoryComments: {},
      ...texts,
    },
    guestNames: ["Zuzana Synthetic"],
    listingNames: ["Synthetic Loft"],
  };
}

function fakeSource(over: Partial<HistorySource> = {}, reviews: readonly NeutralReview[] = [review("1")]) {
  const calls: string[] = [];
  const source: HistorySource = {
    provider: "fake",
    history: { maxDepthMonths: 12 },
    fetchReviewsByStay(_window: TimeWindow) {
      calls.push("reviews");
      return Promise.resolve({ reviews, skipped: 0 });
    },
    fetchStayFacts(_window: TimeWindow) {
      calls.push("stays");
      const stay: NeutralStayFact = {
        external_listing_id: "100",
        channel: "airbnb",
        departure_date: "2026-11-02",
        nights: 2,
      };
      return Promise.resolve([stay, stay]);
    },
    stayGuestNames(_window: TimeWindow) {
      calls.push("names");
      return Promise.resolve(new Map([["r1", ["Mirek Bookingname"]]]));
    },
    fetchListingBirths() {
      calls.push("births");
      return Promise.resolve([{ external_listing_id: "100", born_on: "2022-01-20" }]);
    },
    ...over,
  };
  return { source, calls };
}

function fakeStore(state: HistoryState | null = STATE, grant: HistoryGrant = { granted: true, run_id: 7 }) {
  const log = {
    reserved: [] as { start: string; calls: number; worst: number }[],
    completed: [] as { facts: readonly HistoryFactRow[]; spent: number; counts: Record<string, number> }[],
    failed: [] as { spent: number; codes: string[] }[],
    months: [] as { month: string; rows: readonly MonthStayRow[] }[],
  };
  const store: HistoryStore = {
    state: () => Promise.resolve(state),
    redactionNames: () => Promise.resolve({ staff: ["Petra Staffname"], places: ["Our Place"] }),
    readableListings: (listings) => Promise.resolve(listings.filter((id) => !UNREADABLE.has(id))),
    reserve: (slice, calls, worst) => {
      log.reserved.push({ start: slice.start, calls, worst });
      return Promise.resolve(grant);
    },
    complete: (_id, facts, spent, counts) => {
      log.completed.push({ facts, spent, counts: { ...counts } });
      return Promise.resolve({ labels: facts.length, labels_left_out: 0 });
    },
    fail: (_id, spent, _counts, errors) => {
      log.failed.push({ spent, codes: errors.map((error) => error.code) });
      return Promise.resolve();
    },
    replaceMonthStays: (month, rows) => {
      log.months.push({ month, rows });
      return Promise.resolve(rows.length);
    },
  };
  return { store, log };
}

function fakeModel(answer: (input: ThemeInput) => Promise<ThemeReading> | ThemeReading) {
  const inputs: ThemeInput[] = [];
  const model: ThemeModelClient = {
    read: (input) => {
      inputs.push(input);
      return Promise.resolve(answer(input));
    },
  };
  return { model, inputs };
}

const WIFI: ThemeReading = {
  raw: { complaints: [{ theme: "wifi", severity: "normal", confidence: 0.9 }] },
  inputTokens: 1000,
  outputTokens: 100,
};

const keyOf = (id: string) => Promise.resolve(`key-${id}`);
const now = () => NOW;

Deno.test("the fake keeps the history contract too", async () => {
  const { source } = fakeSource({
    fetchStayFacts: () =>
      Promise.resolve([{ external_listing_id: "100", channel: "airbnb", departure_date: "2026-10-01", nights: 2 }]),
  });
  await checkHistoryContract({
    source,
    window: { since: new Date("2026-09-28"), until: new Date("2026-10-05") },
    reviewIds: ["1"],
    stays: 1,
    booking: { id: "r1", name: "Mirek Bookingname" },
    guestWords: ["Zuzana", "Mirek"],
  });
});

Deno.test("off, nothing is read at all", async () => {
  const { source, calls } = fakeSource();
  const { store, log } = fakeStore({ ...STATE, enabled: false });
  const { model, inputs } = fakeModel(() => WIFI);

  const summary = await runHistory({ store, source, model, keyOf, now });

  assertEquals(summary.status, "off");
  assertEquals(calls, []);
  assertEquals(inputs, []);
  assertEquals(log.reserved, []);
});

Deno.test("a company with no settings reads nothing", async () => {
  const { source, calls } = fakeSource();
  const { store } = fakeStore(null);
  assertEquals((await runHistory({ store, source, model: null, keyOf, now })).status, "off");
  assertEquals(calls, []);
});

Deno.test("a tick reads the newest settled week and stores its labels", async () => {
  const { source } = fakeSource();
  const { store, log } = fakeStore();
  const { model } = fakeModel(() => WIFI);

  const summary = await runHistory({ store, source, model, keyOf, now });

  assertEquals(summary.week, WEEK);
  assertEquals(summary.labels, 1);
  assertEquals(log.reserved, [{ start: WEEK, calls: 1, worst: WORST_CALL_MICRO_USD }]);
  assertEquals(log.completed[0].facts, [{
    external_listing_id: "100",
    external_key: "key-1",
    theme: "wifi",
    severity: "normal",
    confidence: 0.9,
    channel: "airbnb",
    departure_date: "2026-10-01",
  }]);
  assertEquals(log.completed[0].spent, 150);
});

Deno.test("the journal says how far the reading is", async () => {
  const { source } = fakeSource();
  const { store, log } = fakeStore();
  const { model } = fakeModel(() => WIFI);
  const summary = await runHistory({ store, source, model, keyOf, now });
  assertEquals(log.completed[0].counts.weeks_total, 49);
  assertEquals(log.completed[0].counts.weeks_left, 48);
  assertEquals(summary.weeksLeft, 48);
});

Deno.test("the PMS's depth and the company's setting: the less of the two", async () => {
  const shallow = fakeSource({ history: { maxDepthMonths: 3 } });
  const a = fakeStore({ ...STATE, stays_done: {} });
  await runHistory({ store: a.store, source: shallow.source, model: null, keyOf, now });
  assertEquals(a.log.months[0].month, "2026-11-01");
  const stateAll = { ...STATE, stays_done: { "2026-11-01": "2026-11-06T07:00:00Z", "2026-10-01": "2026-11-06T07:00:00Z", "2026-09-01": "2026-11-06T07:00:00Z" } };

  const b = fakeStore(stateAll);
  const summary = await runHistory({ store: b.store, source: shallow.source, model: null, keyOf, now });
  assertEquals(summary.stayMonth, null);

  const c = fakeStore({ ...stateAll, depth_months: 2 });
  const deep = fakeSource({ history: { maxDepthMonths: 24 } });
  assertEquals((await runHistory({ store: c.store, source: deep.source, model: null, keyOf, now })).stayMonth, null);
});

Deno.test("no name goes to the model: the review's, the booking's, ours", async () => {
  const { source } = fakeSource({}, [
    review("1", {}, { publicText: "Zuzana and Mirek from Our Place met Petra at Synthetic Loft." }),
  ]);
  const { store } = fakeStore();
  const { model, inputs } = fakeModel(() => WIFI);

  await runHistory({ store, source, model, keyOf, now });

  const sent = JSON.stringify(inputs);
  for (const word of ["Zuzana", "Mirek", "Petra", "Synthetic Loft", "Our Place"]) {
    assert(!sent.includes(word), word);
  }
  assert(sent.includes("[GUEST]"));
});

Deno.test("a text with no usable name known is not read", async () => {
  const nameless: NeutralReview = { ...review("9"), guestNames: [] };
  const { source } = fakeSource({}, [nameless]);
  const { store, log } = fakeStore();
  const { model, inputs } = fakeModel(() => WIFI);

  await runHistory({ store, source, model, keyOf, now });

  assertEquals(inputs, []);
  assertEquals(log.completed[0].counts.no_names, 1);
});

Deno.test("private feedback never reaches the model while its switch is off", async () => {
  const { source } = fakeSource();
  const { store } = fakeStore();
  const { model, inputs } = fakeModel(() => WIFI);

  await runHistory({ store, source, model, keyOf, now });

  assertEquals(inputs[0].privateText, null);
  assert(!JSON.stringify(inputs).includes("sofa"));
});

Deno.test("a review with private feedback alone is no review to read", async () => {
  const { source } = fakeSource({}, [review("1", {}, { publicText: null })]);
  const { store, log } = fakeStore();
  const { model, inputs } = fakeModel(() => WIFI);

  await runHistory({ store, source, model, keyOf, now });

  assertEquals(inputs, []);
  assertEquals(log.completed[0].counts.no_text, 1);
});

Deno.test("with its switch on, private feedback goes as well", async () => {
  const { source } = fakeSource();
  const { store } = fakeStore({ ...STATE, include_private: true });
  const { model, inputs } = fakeModel(() => WIFI);

  await runHistory({ store, source, model, keyOf, now });

  assert(inputs[0].privateText?.includes("sofa"));
});

Deno.test("nothing of a text is in what the database is given", async () => {
  const { source } = fakeSource();
  const { store, log } = fakeStore();
  const { model } = fakeModel(() => WIFI);

  await runHistory({ store, source, model, keyOf, now });

  const given = JSON.stringify([log.completed, log.reserved, log.failed, log.months]);
  for (const word of ["wifi kept", "Zuzana", "Mirek", "sofa", "Synthetic"]) {
    assert(!given.includes(word), word);
  }
});

Deno.test("a stay from the line on is the stream's, not the reading's", () => {
  const { chosen, counts } = selectReviews(
    [review("1", { arrival_date: "2026-11-04" }), review("2", { arrival_date: "2026-11-03" })],
    { line: "2026-11-04", include_private: false },
    "2025-12-01",
    new Map(),
  );
  assertEquals(chosen.map((item) => item.row.external_id), ["2"]);
  assertEquals(counts.after_line, 1);
});

Deno.test("a hidden review is not read", () => {
  const { chosen, counts } = selectReviews(
    [review("1", { is_hidden: true })],
    { line: null, include_private: false },
    "2025-12-01",
    new Map(),
  );
  assertEquals(chosen, []);
  assertEquals(counts.hidden, 1);
});

Deno.test("a stay before the listing appeared or before the window is not read", () => {
  const { chosen, counts } = selectReviews(
    [
      review("1", { departure_date: "2026-02-28" }),
      review("2", { departure_date: "2026-03-15" }),
      review("3", { departure_date: "2025-11-30", external_listing_id: "200" }),
    ],
    { line: null, include_private: false },
    "2025-12-01",
    new Map([["100", "2026-03-01"]]),
  );
  assertEquals(chosen.map((item) => item.row.external_id), ["2"]);
  assertEquals(counts.below_floor, 2);
});

Deno.test("a label below the floor of confidence is counted, not stored", async () => {
  const { source } = fakeSource();
  const { store, log } = fakeStore();
  const { model } = fakeModel(() => ({
    ...WIFI,
    raw: { complaints: [{ theme: "wifi", severity: "normal", confidence: 0.59 }] },
  }));

  await runHistory({ store, source, model, keyOf, now });

  assertEquals(log.completed[0].facts, []);
  assertEquals(log.completed[0].counts.unsure, 1);
});

for (const reason of ["daily_cap", "budget", "busy"]) {
  Deno.test(`a refusal (${reason}) stops the week before a single call`, async () => {
    const { source } = fakeSource();
    const { store, log } = fakeStore(STATE, { granted: false, reason });
    const { model, inputs } = fakeModel(() => WIFI);

    const summary = await runHistory({ store, source, model, keyOf, now });

    assertEquals(summary.stopped, reason);
    assertEquals(inputs, []);
    assertEquals(log.completed, []);
  });
}

Deno.test("the week is booked as a whole, at its worst case", async () => {
  const { source } = fakeSource({}, [review("1"), review("2"), review("3")]);
  const { store, log } = fakeStore();
  const { model } = fakeModel(() => WIFI);

  await runHistory({ store, source, model, keyOf, now });

  assertEquals(log.reserved[0].calls, 3);
  assertEquals(log.reserved[0].worst, WORST_CALL_MICRO_USD);
});

Deno.test("a week with nothing to read is closed at no cost", async () => {
  const { source } = fakeSource({}, []);
  const { store, log } = fakeStore();
  const { model, inputs } = fakeModel(() => WIFI);

  await runHistory({ store, source, model, keyOf, now });

  assertEquals(inputs, []);
  assertEquals(log.reserved[0].calls, 0);
  assertEquals(log.completed[0].spent, 0);
});

Deno.test("the service failing stops the run, stores nothing and keeps the money counted", async () => {
  const { source } = fakeSource({}, [review("1"), review("2")]);
  const { store, log } = fakeStore();
  const { model } = fakeModel(() => {
    throw new ModelError("service_rate_limited", "service", "Rate limited after the retries");
  });

  const summary = await runHistory({ store, source, model, keyOf, now });

  assertEquals(summary.stopped, "service_rate_limited");
  assertEquals(log.completed, []);
  assertEquals(log.failed[0].codes.includes("service_rate_limited"), true);
  assert(log.failed[0].spent >= WORST_CALL_MICRO_USD);
  assertEquals(summary.weeksLeft, 49);
});

Deno.test("a review the model cannot read costs itself, and the week closes", async () => {
  const { source } = fakeSource({}, [review("1"), review("2")]);
  const { store, log } = fakeStore();
  let calls = 0;
  const { model } = fakeModel(() => {
    calls += 1;
    if (calls === 1) {
      throw new ModelError("model_refused", "review", "The model declined this review");
    }
    return WIFI;
  });

  const summary = await runHistory({ store, source, model, keyOf, now });

  assertEquals(summary.stopped, null);
  assertEquals(log.completed[0].counts.failed, 1);
  assertEquals(log.completed[0].counts.read, 1);
  assertEquals(log.completed[0].spent, WORST_CALL_MICRO_USD + 150);
});

Deno.test("an unknown failure in a row is the service's", async () => {
  const { source } = fakeSource({}, [review("1"), review("2"), review("3"), review("4"), review("5")]);
  const { store, log } = fakeStore();
  const { model } = fakeModel(() => {
    throw new ModelError("model_timeout", "unknown", "The call timed out");
  });

  const summary = await runHistory({ store, source, model, keyOf, now });

  assertEquals(summary.stopped, "model_timeout");
  assertEquals(log.completed, []);
});

Deno.test("an answer that is no reading costs itself", async () => {
  const { source } = fakeSource();
  const { store, log } = fakeStore();
  const { model } = fakeModel(() => ({ ...WIFI, raw: { nonsense: true } }));

  await runHistory({ store, source, model, keyOf, now });

  assertEquals(log.completed[0].counts.failed, 1);
  assertEquals(log.completed[0].facts, []);
});

Deno.test("without the model's key stays are read and reviews wait", async () => {
  const { source, calls } = fakeSource();
  const { store, log } = fakeStore({ ...STATE, stays_done: {} });

  const summary = await runHistory({ store, source, model: null, keyOf, now });

  assertEquals(summary.stayMonth, "2026-11-01");
  assertEquals(summary.week, null);
  assertEquals(calls.includes("reviews"), false);
  assertEquals(log.reserved, []);
  assertEquals(log.months[0].rows, [{ external_listing_id: "100", channel: "airbnb", stays: 2, nights: 4 }]);
});

Deno.test("a tick with nothing owed asks the PMS nothing", async () => {
  const { source, calls } = fakeSource();
  const { store } = fakeStore(STATE);
  const summary = await runHistory({ store, source, model: null, keyOf, now });
  assertEquals(summary.status, "done");
  assertEquals(calls, []);
});

Deno.test("a failing PMS is a code, and nothing was booked", async () => {
  const { source } = fakeSource({
    fetchReviewsByStay: () => Promise.reject(new SignalSourceError("rate_limited", "Slow down")),
  });
  const { store, log } = fakeStore();
  const { model, inputs } = fakeModel(() => WIFI);

  const summary = await runHistory({ store, source, model, keyOf, now });

  assertEquals(summary.stopped, "source_rate_limited");
  assertEquals(summary.errors, [{ code: "source_rate_limited", count: 1 }]);
  assertEquals(log.reserved, []);
  assertEquals(inputs, []);
});

Deno.test("stays of a month add up by listing and channel, before a listing appeared count as none", () => {
  const stay = (over: Partial<NeutralStayFact>): NeutralStayFact => ({
    external_listing_id: "100",
    channel: "airbnb",
    departure_date: "2026-05-10",
    nights: 2,
    ...over,
  });
  const rows = monthRows(
    [
      stay({}),
      stay({ nights: 3 }),
      stay({ channel: "booking" }),
      stay({ external_listing_id: "200", departure_date: "2026-05-01" }),
    ],
    "2025-12-01",
    new Map([["200", "2026-05-05"]]),
    "2026-05-31",
  );
  assertEquals(rows, [
    { external_listing_id: "100", channel: "airbnb", stays: 2, nights: 5 },
    { external_listing_id: "100", channel: "booking", stays: 1, nights: 2 },
  ]);
});

Deno.test("a stay that has not ended is not counted yet", () => {
  const stay = (departure: string): NeutralStayFact => ({
    external_listing_id: "100",
    channel: "airbnb",
    departure_date: departure,
    nights: 2,
  });
  const rows = monthRows(
    [stay("2026-11-05"), stay("2026-11-06"), stay("2026-11-07"), stay("2026-11-30")],
    "2025-12-01",
    new Map(),
    "2026-11-06",
  );
  assertEquals(rows, [{ external_listing_id: "100", channel: "airbnb", stays: 2, nights: 4 }]);
});

Deno.test("a text of a listing the company does not work never reaches the model", async () => {
  const { source } = fakeSource({}, [review("1"), review("2", { external_listing_id: "999" })]);
  const { store, log } = fakeStore();
  const { model, inputs } = fakeModel(() => WIFI);

  await runHistory({ store, source, model, keyOf, now });

  assertEquals(inputs.length, 1);
  assertEquals(log.reserved[0].calls, 1);
  assertEquals(log.completed[0].counts.not_ours, 1);
});

Deno.test("a week that keeps failing is left for the next one", async () => {
  const { source } = fakeSource();
  const { store } = fakeStore({ ...STATE, reviews_stuck: { [WEEK]: 3 } });
  const { model } = fakeModel(() => WIFI);

  const summary = await runHistory({ store, source, model, keyOf, now });

  assertEquals(summary.week, "2026-09-21");
});

Deno.test("a month of stays that cannot be read does not hold the reviews back", async () => {
  const { source } = fakeSource({
    fetchStayFacts: () => Promise.reject(new SignalSourceError("unavailable", "Down")),
  });
  const { store, log } = fakeStore({ ...STATE, stays_done: {} });
  const { model } = fakeModel(() => WIFI);

  const summary = await runHistory({ store, source, model, keyOf, now });

  assertEquals(log.completed.length, 1);
  assertEquals(summary.errors, [{ code: "source_unavailable", count: 1 }]);
});

Deno.test("past the line the stream reads, unless the reading follows", async () => {
  const late = review("7", { arrival_date: "2026-11-05", departure_date: "2026-11-08" });

  const stopped = fakeSource({}, [late]);
  const before = fakeStore(STATE);
  const a = fakeModel(() => WIFI);
  await runHistory({ store: before.store, source: stopped.source, model: a.model, keyOf, now: () => new Date("2026-12-20T08:00:00Z") });
  assertEquals(a.inputs.length, 0);

  const followed = fakeSource({}, [late]);
  const after = fakeStore({ ...STATE, follow: true });
  const b = fakeModel(() => WIFI);
  await runHistory({ store: after.store, source: followed.source, model: b.model, keyOf, now: () => new Date("2026-12-20T08:00:00Z") });
  assertEquals(b.inputs.length, 1);
});
