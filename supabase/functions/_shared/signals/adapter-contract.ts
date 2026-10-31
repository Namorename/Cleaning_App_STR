/**
 * The contract every PMS adapter passes (docs/guest-signals.md §2.2): one
 * suite, registered for an adapter by its harness — a fake PMS in memory, or
 * a real adapter over a synthetic network. Connecting a new PMS means its
 * adapter, this suite green against it, a value of signal_provider and a
 * branch in resolve_signal_place; the core does not change.
 *
 * The suite checks: the PMS's ids are non-empty strings and stable across
 * reads; a message's direction and automation; pages are read to the end,
 * and end; `gone` comes as a type; failures are SignalSourceErrors with
 * their codes and carry no guest text; times are UTC; a place can be
 * resolved; every capability that is on has its method and every one that is
 * off has none; a booking without names.
 *
 * Tests only: no function imports this file.
 */

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

import {
  type ActiveConversation,
  type GuestSignalAdapter,
  type NeutralMessage,
  type NeutralReviewRow,
  type PlaceRef,
  SignalSourceError,
  type SignalSourceErrorCode,
  type TimeWindow,
} from "./adapter.ts";
import { SIGNAL_CHANNELS } from "./types.ts";

/** A failure the scenario sets up, and the code it must come with. */
export interface ContractFailure {
  readonly label: string;
  readonly code: SignalSourceErrorCode;
  readonly run: () => Promise<unknown>;
}

/** One adapter in a known world, and what the suite should find in it. */
export interface ContractScenario {
  readonly adapter: GuestSignalAdapter;
  /** The scenario's synthetic guest texts and names: never in an error, an event or a list. */
  readonly guestWords: readonly string[];
  readonly reviews?: {
    readonly window: TimeWindow;
    /** The reviews published in the window. */
    readonly ids: readonly string[];
    readonly skipped: number;
  };
  readonly activeConversations?: {
    readonly since: Date;
    /** Those with a guest's message at or after `since` — also one no webhook told of. */
    readonly ids: readonly string[];
  };
  readonly conversation?: {
    readonly id: string;
    readonly since: Date;
    readonly guestIds: readonly string[];
    readonly hostIds: readonly string[];
    /** Host messages a template or a scheduler sent. */
    readonly automatedIds: readonly string[];
    /** No words and no files. */
    readonly emptyIds: readonly string[];
    /** Files without words. */
    readonly attachmentOnlyIds: readonly string[];
    /** Sent before `since`: must not come. */
    readonly olderIds: readonly string[];
  };
  /** A conversation whose messages know no booking. */
  readonly conversationWithoutBooking?: { readonly id: string; readonly since: Date };
  readonly webhook?: {
    readonly body: unknown;
    readonly externalId: string;
    readonly externalConversationId: string;
    /** Notifications that are not about a message. */
    readonly others: readonly unknown[];
    /** A message notification without its ids. */
    readonly malformed: unknown;
  };
  readonly bookings: {
    readonly named: string;
    readonly nameless: string;
    readonly gone: string;
    readonly unavailable: string;
    /** A booking of one room inside a listing, and the room. */
    readonly room?: { readonly id: string; readonly unitId: string };
  };
  readonly failures: readonly ContractFailure[];
}

export interface ContractHarness {
  readonly name: string;
  /** A fresh scenario for each check. */
  setUp(): ContractScenario;
}

/** A read that pages must end: a hung pager fails the check instead of the run. */
const DEADLINE_MS = 5_000;

async function withinDeadline<T>(what: string, call: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not end within ${DEADLINE_MS} ms`)), DEADLINE_MS);
  });
  try {
    return await Promise.race([call, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const DAY_MS = 86_400_000;
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value === value.trim();
}

function assertNullableId(value: unknown, what: string): void {
  assert(value === null || isId(value), `${what} is neither null nor a non-empty string: ${JSON.stringify(value)}`);
}

function assertPlace(place: PlaceRef, what: string): void {
  assert(isId(place.externalListingId), `${what}: the listing id is not a non-empty string`);
  assertNullableId(place.externalUnitId, `${what}: the unit id`);
}

function assertValidDate(at: Date, what: string): void {
  assert(at instanceof Date && !Number.isNaN(at.getTime()), `${what} is not a valid moment`);
  assert(UTC_TIME.test(at.toISOString()), `${what} is not a UTC moment`);
}

function assertNoGuestWords(text: string, words: readonly string[], what: string): void {
  for (const word of words) {
    assert(!text.includes(word), `${what} carries the guest's "${word}"`);
  }
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return [error.message, error.stack ?? "", String(error.cause ?? "")].join("\n");
}

function assertReviewRow(row: NeutralReviewRow, window: TimeWindow, words: readonly string[]): void {
  const what = `review ${row.external_id}`;
  assert(isId(row.external_id), `${what}: the id is not a non-empty string`);
  assertPlace({ externalListingId: row.external_listing_id, externalUnitId: row.external_unit_id }, what);
  assertNullableId(row.external_reservation_id, `${what}: the booking id`);
  assert(UTC_TIME.test(row.submitted_at), `${what}: submitted_at is not a UTC ISO time`);
  const sent = Date.parse(row.submitted_at);
  // A PMS may filter by day: a review of the window's first day, before `since` itself, is in.
  assert(sent >= window.since.getTime() - DAY_MS && sent < window.until.getTime(), `${what} is outside the window`);
  assert(row.external_updated_at === null || UTC_TIME.test(row.external_updated_at), `${what}: external_updated_at`);
  for (const day of [row.arrival_date, row.departure_date]) {
    assert(day === null || DAY.test(day), `${what}: a date is not YYYY-MM-DD`);
  }
  assert((SIGNAL_CHANNELS as readonly string[]).includes(row.channel), `${what}: unknown channel`);
  for (const key of ["public_text", "private_text", "category_comments", "listing_id", "room_id", "reservation_id"]) {
    assert(!(key in row), `${what}: the row carries ${key}`);
  }
  assertNoGuestWords(JSON.stringify(row), words, `${what}'s row`);
}

function assertMessage(message: NeutralMessage, conversationId: string, since: Date): void {
  const what = `message ${message.externalId}`;
  assert(isId(message.externalId), `${what}: the id is not a non-empty string`);
  assertEquals(message.externalConversationId, conversationId, `${what}: another conversation`);
  assertValidDate(message.sentAt, `${what}: sentAt`);
  assert(message.sentAt.getTime() >= since.getTime(), `${what} was sent before the window`);
  assert(["guest", "host", "system"].includes(message.direction), `${what}: unknown direction`);
  assertEquals(typeof message.automated, "boolean", `${what}: automated is not a flag`);
  assert(!(message.automated && message.direction === "guest"), `${what}: a guest's message marked automatic`);
  assert((SIGNAL_CHANNELS as readonly string[]).includes(message.channel), `${what}: unknown channel`);
  assertPlace(message.place, what);
  assertNullableId(message.externalReservationId, `${what}: the booking id`);
  assert(message.text === null || (typeof message.text === "string" && message.text.trim() !== ""), `${what}: text`);
  assert(Number.isInteger(message.attachments) && message.attachments >= 0, `${what}: attachments`);
}

/** Messages by id, the same content on a second read. */
function byId(messages: readonly NeutralMessage[]): Map<string, NeutralMessage> {
  return new Map(messages.map((message) => [message.externalId, message]));
}

function sorted(ids: Iterable<string>): string[] {
  return [...ids].sort();
}

/** A part of the scenario a capability that is on must have: an unexercised capability fails, never passes. */
function exercised<T>(part: T | undefined, what: string): T {
  assert(part !== undefined, `The adapter can do ${what}, and the scenario does not exercise it`);
  return part;
}

/** Registers the contract's checks for one adapter. */
export function registerAdapterContract(harness: ContractHarness): void {
  const test = (name: string, check: (scenario: ContractScenario) => Promise<void> | void) =>
    Deno.test(`contract (${harness.name}): ${name}`, async () => {
      await check(harness.setUp());
    });

  test("every capability that is on has its method, and every one that is off has none", ({ adapter }) => {
    const { capabilities: caps } = adapter;
    const has = (method: unknown) => typeof method === "function";
    assertEquals(has(adapter.fetchReviews), caps.reviews !== false, "fetchReviews");
    const messages = caps.messages === false ? null : caps.messages;
    assertEquals(has(adapter.parseWebhook), messages?.webhook === true, "parseWebhook");
    assertEquals(has(adapter.listActiveConversations), messages?.poll === true, "listActiveConversations");
    assertEquals(has(adapter.fetchConversation), messages?.fetchConversation === true, "fetchConversation");
    assertEquals(has(adapter.conversationUrl), caps.conversationUrl, "conversationUrl");
    assert(has(adapter.namesOf), "namesOf is required");
    assert(isId(adapter.provider), "the provider");
  });

  test("reviews: the PMS's ids as strings, UTC times, no text in a row, the same on a second read", async (s) => {
    if (s.adapter.fetchReviews === undefined) {
      return;
    }
    const reviews = exercised(s.reviews, "reviews");
    const first = await withinDeadline("fetchReviews", s.adapter.fetchReviews(reviews.window));
    const second = await withinDeadline("fetchReviews", s.adapter.fetchReviews(reviews.window));
    assertEquals(sorted(first.reviews.map((r) => r.row.external_id)), sorted(reviews.ids));
    assertEquals(first.skipped, reviews.skipped);
    for (const review of first.reviews) {
      assertReviewRow(review.row, reviews.window, s.guestWords);
      assert(review.guestNames.every(isId), "a guest name is blank");
    }
    assertEquals(second.reviews.map((r) => r.row), first.reviews.map((r) => r.row), "a second read differs");
  });

  test("active conversations: ids as strings, newest first, since the window, the same on a second read", async (s) => {
    if (s.adapter.listActiveConversations === undefined) {
      return;
    }
    const { since, ids } = exercised(s.activeConversations, "the polling of conversations");
    const first = await withinDeadline("listActiveConversations", s.adapter.listActiveConversations(since));
    const second = await withinDeadline("listActiveConversations", s.adapter.listActiveConversations(since));
    assertEquals(sorted(first.map((c) => c.externalConversationId)), sorted(ids));
    assertEquals(new Set(first.map((c) => c.externalConversationId)).size, first.length, "a conversation twice");
    first.forEach((conversation: ActiveConversation, index) => {
      assert(isId(conversation.externalConversationId), "a conversation id");
      assertValidDate(conversation.lastGuestAt, "lastGuestAt");
      assert(conversation.lastGuestAt.getTime() >= since.getTime(), "a conversation older than the window");
      assertNullableId(conversation.externalListingId, "a listing id");
      assertNullableId(conversation.externalReservationId, "a booking id");
      const before = first[index - 1];
      assert(
        before === undefined || before.lastGuestAt.getTime() >= conversation.lastGuestAt.getTime(),
        "not newest first",
      );
    });
    assertNoGuestWords(JSON.stringify(first), s.guestWords, "the list of conversations");
    assertEquals(second, first, "a second read differs");
  });

  test("a conversation: ids, direction and automation, UTC times, every page read and the window kept", async (s) => {
    if (s.adapter.fetchConversation === undefined) {
      return;
    }
    const c = exercised(s.conversation, "a conversation");
    const first = await withinDeadline("fetchConversation", s.adapter.fetchConversation(c.id, c.since));
    const second = await withinDeadline("fetchConversation", s.adapter.fetchConversation(c.id, c.since));
    for (const message of first) {
      assertMessage(message, c.id, c.since);
    }
    const found = byId(first);
    assertEquals(found.size, first.length, "a message twice");
    const expected = [...c.guestIds, ...c.hostIds, ...c.automatedIds, ...c.emptyIds, ...c.attachmentOnlyIds];
    assertEquals(sorted(found.keys()), sorted(new Set(expected)), "not every page was read, or too much was");
    for (const id of c.olderIds) {
      assert(!found.has(id), `${id} is older than the window`);
    }
    const message = (id: string) => found.get(id) as NeutralMessage;
    for (const id of c.guestIds) {
      assertEquals([message(id).direction, message(id).automated], ["guest", false], id);
    }
    for (const id of c.hostIds) {
      assertEquals([message(id).direction, message(id).automated], ["host", false], id);
    }
    for (const id of c.automatedIds) {
      assertEquals([message(id).direction, message(id).automated], ["host", true], id);
    }
    for (const id of c.emptyIds) {
      assertEquals([message(id).text, message(id).attachments], [null, 0], id);
    }
    for (const id of c.attachmentOnlyIds) {
      assertEquals(message(id).text, null, id);
      assert(message(id).attachments > 0, `${id} lost its attachments`);
    }
    assertEquals(sorted(byId(second).keys()), sorted(found.keys()), "a second read differs");
    for (const again of second) {
      assertEquals(again, found.get(again.externalId), `${again.externalId} differs on a second read`);
    }
  });

  test("a conversation without a booking: its messages name none", async (s) => {
    if (s.adapter.fetchConversation === undefined) {
      return;
    }
    const { id, since } = exercised(s.conversationWithoutBooking, "a conversation without a booking");
    const messages = await withinDeadline("fetchConversation", s.adapter.fetchConversation(id, since));
    assert(messages.length > 0, "the conversation is empty");
    for (const message of messages) {
      assertMessage(message, id, since);
      assertEquals(message.externalReservationId, null);
    }
  });

  test("a webhook: the message's ids without its text, the same for a repeat, null for anything else", (s) => {
    if (s.adapter.parseWebhook === undefined) {
      return;
    }
    const { body, externalId, externalConversationId, others, malformed } = exercised(s.webhook, "a webhook");
    const headers = new Headers();
    const event = s.adapter.parseWebhook({ headers, body });
    assert(event !== null, "a message notification was not read");
    assertEquals([event.externalId, event.externalConversationId], [externalId, externalConversationId]);
    assertValidDate(event.sentAt, "the event's sentAt");
    assertPlace(event.place, "the event");
    assertNullableId(event.externalReservationId, "the event's booking id");
    assertNullableId(event.externalAccountId, "the event's account id");
    assert(!("text" in event), "the event carries a text field");
    assertNoGuestWords(JSON.stringify(event), s.guestWords, "the event");
    assertEquals(s.adapter.parseWebhook({ headers, body }), event, "a repeated webhook reads differently");
    for (const other of others) {
      assertEquals(s.adapter.parseWebhook({ headers, body: other }), null, JSON.stringify(other));
    }
    let failure: unknown = null;
    try {
      s.adapter.parseWebhook({ headers, body: malformed });
    } catch (error: unknown) {
      failure = error;
    }
    assert(failure instanceof SignalSourceError, "a broken message notification passed");
    assertEquals(failure.code, "bad_row");
    assertNoGuestWords(errorText(failure), s.guestWords, "the error");
  });

  test("names of a booking: ok with names or without, gone as a type, unavailable; a room inside a listing", async (s) => {
    const { named, nameless, gone, unavailable, room } = s.bookings;
    const names = await s.adapter.namesOf(named);
    assert(names.status === "ok", "a booking with names");
    assert(names.names.length > 0 && names.names.every(isId), "the names");
    assertNullableId(names.externalUnitId, "the unit id");
    const none = await s.adapter.namesOf(nameless);
    assert(none.status === "ok", "a booking without names");
    assertEquals(none.names, []);
    assertEquals(await s.adapter.namesOf(gone), { status: "gone" });
    assertEquals(await s.adapter.namesOf(unavailable), { status: "unavailable" });
    if (s.adapter.capabilities.units) {
      const roomed = await s.adapter.namesOf(exercised(room, "a room inside a listing").id);
      assert(roomed.status === "ok", "a booking of a room");
      assertEquals(roomed.externalUnitId, room?.unitId);
    }
  });

  test("a link to a conversation, where the PMS has one, is https", (s) => {
    if (s.adapter.conversationUrl === undefined) {
      return;
    }
    const id = s.conversation?.id ?? "1";
    assert(s.adapter.conversationUrl(id).startsWith("https://"), "not an https link");
  });

  test("failures are SignalSourceErrors with their codes, and carry no guest text", async (s) => {
    assert(s.failures.length > 0, "the scenario sets up no failure");
    for (const failure of s.failures) {
      const error = await assertRejects(() => withinDeadline(failure.label, failure.run()), SignalSourceError);
      assertEquals(error.code, failure.code, failure.label);
      assertNoGuestWords(errorText(error), s.guestWords, failure.label);
    }
  });
}
