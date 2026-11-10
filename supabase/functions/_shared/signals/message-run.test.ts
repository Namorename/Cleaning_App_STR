import { assert, assertEquals } from "jsr:@std/assert@1";

import type { ActiveConversation } from "./adapter.ts";
import { ModelError } from "./classify.ts";
import { FAKE_GUEST_WORDS, FAKE_IDS, FakePms, fakeWorld, type FakeWorld } from "./fake-pms.ts";
import type { MessageThemeClient, MessageThemeInput, MessageThemeReading } from "./message-read.ts";
import {
  type ApplyInput,
  type ClaimedConversation,
  type ConversationStay,
  type MessageState,
  type MessageStore,
  phaseOf,
  type Reservation,
  runMessages,
} from "./message-run.ts";
import type { RunError } from "./types.ts";

const STATE: MessageState = {
  enabled: true,
  daily_cap: 150,
  daily_budget: 250_000,
  month_budget: 5_000_000,
  min_confidence: 0.6,
  calls_today: 0,
  spent_today: 0,
  spent_month: 0,
  poll_due: false,
};

/** The stay of the scenario's booking: 13–16 October, FAKE_NOW on the 15th. */
const STAY: ConversationStay = {
  property_id: 1,
  room_id: null,
  reservation_id: 1,
  arrival_date: "2026-10-13",
  departure_date: "2026-10-16",
  cancelled: false,
};

function claimed(id: string, booking: string | null = "fake-booking-1", readTo: string | null = null): ClaimedConversation {
  return {
    external_conversation_id: id,
    external_listing_id: "fake-listing-1",
    external_reservation_id: booking,
    read_to: readTo,
  };
}

class FakeStore implements MessageStore {
  readonly applied: ApplyInput[] = [];
  readonly finished: Array<{ id: string; readTo: Date | null; error: string | null }> = [];
  readonly failedRuns: number[] = [];
  readonly logs: Array<{ isOk: boolean; counts: Readonly<Record<string, number>>; errors: readonly RunError[] }> = [];
  readonly polled: ActiveConversation[][] = [];
  claimCalls = 0;
  reservations = 0;

  constructor(
    readonly opts: {
      state?: MessageState | null;
      queue?: readonly ClaimedConversation[];
      stay?: ConversationStay | null;
      grants?: number;
      refusal?: string;
      collected?: number;
    } = {},
  ) {}

  state() {
    return Promise.resolve(this.opts.state === undefined ? STATE : this.opts.state);
  }
  collect() {
    return Promise.resolve(this.opts.collected ?? 0);
  }
  queuePolled(rows: readonly ActiveConversation[]) {
    this.polled.push([...rows]);
    return Promise.resolve({ queued: rows.length, missed: rows.length });
  }
  claim(_limit: number) {
    this.claimCalls += 1;
    return Promise.resolve(this.opts.queue ?? []);
  }
  stay(_listing: string, _unit: string | null, _reservation: string | null) {
    return Promise.resolve(this.opts.stay === undefined ? STAY : this.opts.stay);
  }
  reserve(_worst: number): Promise<Reservation> {
    if (this.reservations >= (this.opts.grants ?? 100)) {
      return Promise.resolve({ granted: false, reason: this.opts.refusal ?? "daily_cap" });
    }
    this.reservations += 1;
    return Promise.resolve({ granted: true, runId: this.reservations });
  }
  apply(input: ApplyInput) {
    this.applied.push(input);
    return Promise.resolve({ messages: input.messages.length, labels: input.labels.length });
  }
  failRun(runId: number) {
    this.failedRuns.push(runId);
    return Promise.resolve();
  }
  finish(id: string, readTo: Date | null, error: string | null) {
    this.finished.push({ id, readTo, error });
    return Promise.resolve();
  }
  redactionNames() {
    return Promise.resolve({ staff: ["Tomas Technik"], places: ["Fake Flat One"] });
  }
  log(isOk: boolean, counts: Readonly<Record<string, number>>, errors: readonly RunError[]) {
    this.logs.push({ isOk, counts, errors });
    return Promise.resolve();
  }
}

class FakeModel implements MessageThemeClient {
  readonly inputs: MessageThemeInput[] = [];
  constructor(readonly answer: unknown = {
    complaints: [{ theme: "hot_water", severity: "high", confidence: 0.9, resolved: false }],
  }, readonly failure: ModelError | null = null) {}
  read(input: MessageThemeInput): Promise<MessageThemeReading> {
    this.inputs.push(input);
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    return Promise.resolve({ raw: this.answer, inputTokens: 1500, outputTokens: 40 });
  }
}

const keyOf = (id: string) => Promise.resolve(`key:${id}`);
const conversationKeyOf = (id: string) => Promise.resolve(`conv:${id}`);
const NOW = () => new Date("2026-10-15T12:30:00Z");

function deps(store: FakeStore, model: MessageThemeClient | null, world: FakeWorld = fakeWorld()) {
  return { store, adapter: new FakePms(world), model, keyOf, conversationKeyOf, now: NOW };
}

Deno.test("off: nothing is collected, claimed or read", async () => {
  const store = new FakeStore({ state: { ...STATE, enabled: false }, queue: [claimed(FAKE_IDS.stay)] });
  const model = new FakeModel();
  const summary = await runMessages(deps(store, model));
  assertEquals(summary.status, "off");
  assertEquals(store.claimCalls, 0);
  assertEquals(model.inputs.length, 0);
  assertEquals(store.logs.length, 0);
});

Deno.test("a stay's new guest messages are read once, redacted, and stored as keys and labels", async () => {
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.stay)] });
  const model = new FakeModel();
  const summary = await runMessages(deps(store, model));

  assertEquals(summary.read, 1);
  assertEquals(model.inputs.length, 1);
  const sent = JSON.stringify(model.inputs[0]);
  // The guest's words went out redacted; the host's and the automatic ones never.
  assert(sent.includes("the shower has no hot water"));
  assert(!sent.includes("We are sending a technician"));
  assert(!sent.includes("Your check-in details"));
  for (const word of FAKE_GUEST_WORDS.filter((w) => !w.startsWith("FAKE-"))) {
    assert(!sent.includes(word), word);
  }
  assertEquals(model.inputs[0].phase, "stay");

  assertEquals(store.applied.length, 1);
  const applied = store.applied[0];
  // The guest's three messages of the stay (one with words, an empty one, one with
  // files); the one from before the stay is not the stay's.
  assertEquals(applied.messages.map((m) => m.external_id).sort(), [FAKE_IDS.attachment, FAKE_IDS.empty, FAKE_IDS.guest].sort());
  assertEquals(applied.messages.every((m) => m.external_key.startsWith("key:")), true);
  assertEquals(applied.conversation.conversation_key, `conv:${FAKE_IDS.stay}`);
  assertEquals(applied.labels, [{ theme: "hot_water", severity: "high", confidence: 0.9, resolved: false }]);
  assertEquals(applied.runId, 1);
  assertEquals(applied.spentMicroUsd, 170);
  assertEquals(applied.readTo.toISOString(), "2026-10-14T09:05:00.000Z");
  // No column of the call holds a text.
  assert(!JSON.stringify(applied).includes("FAKE-GUEST-TEXT"));
  assertEquals(store.logs.length, 1);
  assertEquals(store.logs[0].isOk, true);
});

Deno.test("read up to its line: nothing new, no call, the line stays", async () => {
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.stay, "fake-booking-1", "2026-10-14T09:05:00Z")] });
  const model = new FakeModel();
  await runMessages(deps(store, model));
  assertEquals(model.inputs.length, 0);
  assertEquals(store.applied.length, 0);
  assertEquals(store.finished, [{ id: FAKE_IDS.stay, readTo: new Date("2026-10-14T09:05:00Z"), error: null }]);
});

Deno.test("a message after the line is read with the earlier ones as context", async () => {
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.stay, "fake-booking-1", "2026-10-14T08:30:00Z")] });
  const model = new FakeModel();
  await runMessages(deps(store, model));
  // The new ones have no words (an empty message, files): keys only, no call.
  assertEquals(model.inputs.length, 0);
  assertEquals(store.applied[0].labels, []);
  assertEquals(store.applied[0].messages.map((m) => m.external_id).sort(), [FAKE_IDS.attachment, FAKE_IDS.empty].sort());
});

Deno.test("no booking's names: no text goes to the model", async () => {
  const world = fakeWorld({ bookings: { "fake-booking-1": { status: "ok", names: ["-"], externalUnitId: null } } });
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.stay)] });
  const model = new FakeModel();
  const summary = await runMessages(deps(store, model, world));
  assertEquals(model.inputs.length, 0);
  assertEquals(store.applied.length, 1);
  assertEquals(store.applied[0].labels, []);
  assertEquals(summary.counts.no_names, 1);
});

Deno.test("names not readable now: the conversation waits, nothing goes out", async () => {
  const world = fakeWorld({ bookings: { "fake-booking-1": { status: "unavailable" } } });
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.stay)] });
  const model = new FakeModel();
  await runMessages(deps(store, model, world));
  assertEquals(model.inputs.length, 0);
  assertEquals(store.finished, [{ id: FAKE_IDS.stay, readTo: null, error: "source_names_unavailable" }]);
});

Deno.test("not a stay of ours: nothing is read", async () => {
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.stay)], stay: null });
  const model = new FakeModel();
  const summary = await runMessages(deps(store, model));
  assertEquals(model.inputs.length, 0);
  assertEquals(store.finished, [{ id: FAKE_IDS.stay, readTo: null, error: null }]);
  assertEquals(summary.counts.not_ours, 1);
});

Deno.test("a cancelled booking is no stay", async () => {
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.stay)], stay: { ...STAY, cancelled: true } });
  const model = new FakeModel();
  const summary = await runMessages(deps(store, model));
  assertEquals(model.inputs.length, 0);
  assertEquals(summary.counts.no_stay, 1);
});

Deno.test("the day's calls run out: the tick stops, the rest wait", async () => {
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.stay), claimed(FAKE_IDS.room, "fake-booking-room")], grants: 0 });
  const model = new FakeModel();
  const summary = await runMessages(deps(store, model));
  assertEquals(model.inputs.length, 0);
  assertEquals(summary.stopped, "daily_cap");
  assertEquals(store.finished.map((f) => f.error), ["daily_cap", "daily_cap"]);
});

Deno.test("no room left before the tick: nothing is claimed", async () => {
  const store = new FakeStore({ state: { ...STATE, calls_today: 150 }, queue: [claimed(FAKE_IDS.stay)] });
  const summary = await runMessages(deps(store, new FakeModel()));
  assertEquals(store.claimCalls, 0);
  assertEquals(summary.stopped, "ceiling");
});

Deno.test("the model's service fails: the call is counted, no more calls this tick", async () => {
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.stay), claimed(FAKE_IDS.room, "fake-booking-room")] });
  const model = new FakeModel(undefined, new ModelError("service_overloaded", "service", "The API is overloaded"));
  const summary = await runMessages(deps(store, model));
  assertEquals(model.inputs.length, 1);
  assertEquals(store.failedRuns, [1]);
  assertEquals(store.finished.map((f) => f.error), ["service_overloaded", "service_overloaded"]);
  assertEquals(store.logs[0].isOk, false);
  assertEquals(summary.stopped, "service_overloaded");
});

Deno.test("the PMS refuses a conversation: a code, and it waits", async () => {
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.limited)] });
  const summary = await runMessages(deps(store, new FakeModel()));
  assertEquals(store.finished, [{ id: FAKE_IDS.limited, readTo: null, error: "source_rate_limited" }]);
  assertEquals(summary.errors, [{ code: "source_rate_limited", count: 1 }]);
  assert(!JSON.stringify(store.logs).includes("FAKE-GUEST-TEXT"));
});

Deno.test("without a key for the model, conversations wait in the queue", async () => {
  const store = new FakeStore({ queue: [claimed(FAKE_IDS.stay)], collected: 1 });
  const summary = await runMessages(deps(store, null));
  assertEquals(store.claimCalls, 0);
  assertEquals(summary.stopped, "no_model");
});

Deno.test("the hourly poll hands the PMS's active conversations to the queue", async () => {
  const store = new FakeStore({ state: { ...STATE, poll_due: true } });
  const summary = await runMessages({ ...deps(store, new FakeModel()), now: () => new Date("2026-10-14T19:00:00Z") });
  assertEquals(store.polled.length, 1);
  assert(store.polled[0].some((c) => c.externalConversationId === FAKE_IDS.missedWebhook));
  assertEquals(summary.missed, store.polled[0].length);
});

Deno.test("a quiet tick writes nothing to the journal but once an hour", async () => {
  const quiet = new FakeStore();
  await runMessages(deps(quiet, new FakeModel()));
  assertEquals(quiet.logs.length, 0);
  const onTheHour = new FakeStore();
  await runMessages({ ...deps(onTheHour, new FakeModel()), now: () => new Date("2026-10-15T13:01:00Z") });
  assertEquals(onTheHour.logs.length, 1);
});

Deno.test("the phase of a message is its Prague day against the stay's", () => {
  assertEquals(phaseOf(new Date("2026-10-12T23:30:00Z"), "2026-10-13", "2026-10-16"), "arrival_day");
  assertEquals(phaseOf(new Date("2026-10-12T21:30:00Z"), "2026-10-13", "2026-10-16"), null);
  assertEquals(phaseOf(new Date("2026-10-14T10:00:00Z"), "2026-10-13", "2026-10-16"), "stay");
  assertEquals(phaseOf(new Date("2026-10-16T08:00:00Z"), "2026-10-13", "2026-10-16"), "departure_day");
  assertEquals(phaseOf(new Date("2026-10-16T22:30:00Z"), "2026-10-13", "2026-10-16"), null);
});
