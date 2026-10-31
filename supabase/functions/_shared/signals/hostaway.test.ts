import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

import { HostawayError } from "../hostaway.ts";
import { SignalSourceError } from "./adapter.ts";
import {
  ConversationListFence,
  HOSTAWAY_CAPABILITIES,
  normalizeHostawayReview,
  parseHostawayDate,
  parseHostawayTime,
  toSignalSourceError,
} from "./hostaway.ts";
import {
  HOSTAWAY_GUEST_WORDS,
  hostawayAdapterOn,
  hostawayConversation,
  hostawayMessage,
  hostawayMessageWebhook,
  hostawayReview,
} from "./hostaway-fake-api.ts";

// Synthetic rows in Hostaway's shape (field names as the API sends them,
// docs/guest-signals.md §3.1, docs/reviews-to-tasks.md §1.1). No real guest,
// text or id; no request leaves the process.

const SINCE = new Date("2026-10-13T00:00:00Z");

function codeOf(call: () => unknown): string {
  try {
    call();
  } catch (error: unknown) {
    return error instanceof SignalSourceError ? error.code : "other";
  }
  return "none";
}

Deno.test("a Hostaway review becomes the neutral row: the PMS's ids as strings, no name, texts beside it", () => {
  const review = normalizeHostawayReview(hostawayReview());

  assertEquals(review.row.external_id, "90000001");
  assertEquals(review.row.external_listing_id, "700001");
  assertEquals(review.row.external_unit_id, null);
  assertEquals(review.row.external_reservation_id, "80000001");
  assertEquals(review.row.channel, "airbnb");
  assertEquals(review.row.category_ratings, { cleanliness: 10, checkin: 6 });
  assertEquals(review.row.arrival_date, "2026-10-10");
  assertEquals(review.row.submitted_at, "2026-10-15T09:30:00Z");
  assertEquals(review.row.has_public_text, true);
  assertEquals(review.row.has_private_text, false);
  assertEquals(review.row.is_hidden, false);
  assertEquals(review.texts.categoryComments, { checkin: "SYNTH-COMMENT-TEXT: the key box code was wrong." });
  assertEquals(review.guestNames, ["Synthia Reviewer", "Synthia"]);
  assertEquals(review.listingNames, ["Test Flat A", "TF-A", "Cosy test flat"]);
  for (const ours of ["listing_id", "room_id", "reservation_id"]) {
    assert(!(ours in review.row), `the row carries our ${ours}`);
  }
  assert(!JSON.stringify(review.row).includes("Synthia"), "a guest name reached the row");
  assert(!("public_text" in review.row), "a text reached the row before redaction");
});

Deno.test("an unknown channel is other, a hidden flag of 1 is hidden, a reply is seen, an id as text is read", () => {
  const review = normalizeHostawayReview(
    hostawayReview({ channelId: 9999, isHidden: 1, revieweeResponse: "Thank you!", reservationId: "80000002" }),
  );
  assertEquals(review.row.channel, "other");
  assertEquals(review.row.is_hidden, true);
  assertEquals(review.row.has_host_reply, true);
  assertEquals(review.row.external_reservation_id, "80000002");
});

Deno.test("a row without an id, a listing or a time it was sent is refused, not guessed", () => {
  for (const broken of [{ id: null }, { listingMapId: "x" }, { submittedAt: "yesterday" }]) {
    assertEquals(codeOf(() => normalizeHostawayReview(hostawayReview(broken))), "bad_row");
  }
  assertEquals(codeOf(() => normalizeHostawayReview("not a review")), "bad_row");
});

Deno.test("Hostaway's times and dates are read as UTC days and moments", () => {
  assertEquals(parseHostawayTime("2026-01-31 23:59:59"), "2026-01-31T23:59:59Z");
  assertEquals(parseHostawayTime("31.01.2026"), null);
  assertEquals(parseHostawayDate("2026-02-01 00:00:00"), "2026-02-01");
  assertEquals(parseHostawayDate(null), null);
});

Deno.test("Hostaway's capabilities: everything but a link into its inbox, which is not verified", () => {
  assertEquals(HOSTAWAY_CAPABILITIES.conversationUrl, false);
  assertEquals(HOSTAWAY_CAPABILITIES.units, true);
  assertEquals(HOSTAWAY_CAPABILITIES.reservationLink, true);
  assertEquals(HOSTAWAY_CAPABILITIES.reviews, { since: true, privateText: true });
});

Deno.test("reviews: guest reviews asked from the day, oldest first; the published ones in the window kept", async () => {
  const { adapter, api } = hostawayAdapterOn({
    reviews: [
      hostawayReview({ id: 1, submittedAt: "2026-10-12 08:00:00" }),
      hostawayReview({ id: 2, status: "awaiting", submittedAt: "2026-10-13 08:00:00" }),
      hostawayReview({ id: 3, submittedAt: "2026-10-15 13:00:00" }),
      hostawayReview({ id: 4, listingMapId: null, submittedAt: "2026-10-14 08:00:00" }),
    ],
  });

  const fetched = await adapter.fetchReviews({
    since: new Date("2026-10-12T06:00:00Z"),
    until: new Date("2026-10-15T12:00:00Z"),
  });

  assertEquals(fetched.reviews.map((r) => r.row.external_id), ["1"]);
  assertEquals(fetched.skipped, 1);
  const list = new URL(`https://api.invalid/${api.requests[0]}`);
  assertEquals(list.pathname, "/reviews");
  assertEquals(list.searchParams.get("type"), "guest-to-host");
  assertEquals(list.searchParams.get("submittedAtStart"), "2026-10-12");
  assertEquals(list.searchParams.get("sortBy"), "submittedAt");
  assertEquals(list.searchParams.get("sortOrder"), "asc");
});

Deno.test("reviews: another type in the answer means the filter did not hold, and the run stops", async () => {
  const { adapter } = hostawayAdapterOn({ reviews: [hostawayReview({ type: "host-to-guest" })] });
  const error = await assertRejects(
    () => adapter.fetchReviews({ since: new Date("2026-10-12T00:00:00Z"), until: new Date("2026-10-16T00:00:00Z") }),
    SignalSourceError,
  );
  assertEquals(error.code, "filter_ignored");
});

Deno.test("names of a booking: one request with its resources; its names and its one room", async () => {
  const { adapter, api } = hostawayAdapterOn({
    reservations: {
      "80000001": {
        id: 80000001,
        reservationUnit: [{ listingUnitId: 61011 }, { listingUnitId: "61011" }],
        guestName: "Synthia Booker",
        guestFirstName: "Synthia",
        guestLastName: "Booker",
      },
      "80000002": { reservationUnit: [{ listingUnitId: 61011 }, { listingUnitId: 61012 }] },
    },
  });

  assertEquals(await adapter.namesOf("80000001"), {
    status: "ok",
    names: ["Synthia Booker", "Synthia", "Booker"],
    externalUnitId: "61011",
  });
  assertEquals(api.requests, ["reservations/80000001?includeResources=1"]);
  assertEquals(await adapter.namesOf("80000002"), { status: "ok", names: [], externalUnitId: null });
});

Deno.test("names of a booking Hostaway no longer has: gone, as a type; any other failure: unavailable", async () => {
  const { adapter } = hostawayAdapterOn({
    failures: {
      "reservations/80000003": { status: 400 },
      "reservations/80000004": { status: 503 },
      "reservations/80000005": { refusal: "SYNTH-GUEST-TEXT" },
    },
  });
  assertEquals(await adapter.namesOf("80000001"), { status: "gone" });
  assertEquals(await adapter.namesOf("80000003"), { status: "unavailable" });
  assertEquals(await adapter.namesOf("80000004"), { status: "unavailable" });
  assertEquals(await adapter.namesOf("80000005"), { status: "unavailable" });
});

Deno.test("names of an id that cannot be a Hostaway booking: gone, and nothing is asked", async () => {
  const { adapter, api } = hostawayAdapterOn({});
  for (const id of ["", "abc", "0", "-1", "1/../listings", "80000001?x=1"]) {
    assertEquals(await adapter.namesOf(id), { status: "gone" }, id);
  }
  assertEquals(api.requests, []);
});

Deno.test("a message webhook: the routing fields as strings, its time in UTC, never its text", () => {
  const { adapter } = hostawayAdapterOn({});
  const body = hostawayMessageWebhook(
    hostawayMessage(60000001, 70000001, "2026-10-14 08:00:00", { channelId: 2005, insertedOn: "2026-10-14 08:00:07" }),
  );
  const event = adapter.parseWebhook({ headers: new Headers(), body });

  assertEquals(event, {
    externalId: "60000001",
    externalConversationId: "70000001",
    externalAccountId: "12345",
    // insertedOn, whose UTC is measured; `date` is the fallback.
    sentAt: new Date("2026-10-14T08:00:07Z"),
    direction: "guest",
    automated: false,
    channel: "booking",
    place: { externalListingId: "700001", externalUnitId: null },
    externalReservationId: "80000001",
  });
  assert(!JSON.stringify(event).includes("SYNTH-GUEST-TEXT"));
});

Deno.test("a message webhook by event or by object; the time falls back to date; others are null", () => {
  const { adapter } = hostawayAdapterOn({});
  const headers = new Headers();
  const message = hostawayMessage(60000001, 70000001, "2026-10-14 08:00:00", { insertedOn: null });
  const byEvent = adapter.parseWebhook({ headers, body: { event: "message.received", data: message } });
  assertEquals(byEvent?.sentAt, new Date("2026-10-14T08:00:00Z"));
  const byObject = adapter.parseWebhook({ headers, body: { object: "conversationMessage", data: message } });
  assertEquals(byObject?.externalId, "60000001");
  for (const other of [{ object: "reservation", event: "reservation.created", data: { id: 1 } }, {}, 7]) {
    assertEquals(adapter.parseWebhook({ headers, body: other }), null);
  }
});

Deno.test("a message: direction from isIncoming, automation only on the host's side, files counted", async () => {
  const { adapter } = hostawayAdapterOn({
    messages: {
      "70000001": [
        hostawayMessage(1, 70000001, "2026-10-14 08:00:00", { communicationId: 7 }),
        hostawayMessage(2, 70000001, "2026-10-14 08:01:00", { isIncoming: 0, communicationEvent: "departure" }),
        hostawayMessage(3, 70000001, "2026-10-14 08:02:00", { isIncoming: 0, userId: 5, body: "  On our way.  " }),
        hostawayMessage(4, 70000001, "2026-10-14 08:03:00", {
          body: "   ",
          attachments: [{}, {}],
          imagesUrls: ["https://files.invalid/x.jpg"],
          channelId: 2005,
        }),
      ],
    },
  });
  const messages = await adapter.fetchConversation("70000001", SINCE);

  assertEquals(messages.map((m) => [m.externalId, m.direction, m.automated]), [
    ["1", "guest", false],
    ["2", "host", true],
    ["3", "host", false],
    ["4", "guest", false],
  ]);
  assertEquals(messages[2].text, "On our way.");
  assertEquals([messages[3].text, messages[3].attachments, messages[3].channel], [null, 3, "booking"]);
  assertEquals(messages[0].place, { externalListingId: "700001", externalUnitId: null });
});

Deno.test("a conversation is read page by page to its end; older messages and repeats are left out", async () => {
  const { adapter, api } = hostawayAdapterOn({
    messages: {
      "70000001": [
        hostawayMessage(1, 70000001, "2026-10-12 08:00:00"),
        hostawayMessage(2, 70000001, "2026-10-13 08:00:00"),
        hostawayMessage(2, 70000001, "2026-10-13 08:00:00"),
        hostawayMessage(3, 70000001, "2026-10-14 08:00:00"),
        hostawayMessage(4, 70000001, "2026-10-15 08:00:00"),
      ],
    },
  }, { messagesPageSize: 2 });
  const messages = await adapter.fetchConversation("70000001", SINCE);

  assertEquals(messages.map((m) => m.externalId), ["2", "3", "4"]);
  assertEquals(api.requests.map((r) => new URL(`https://api.invalid/${r}`).searchParams.get("offset")), [
    "0",
    "2",
    "4",
  ]);
  assert(api.requests.every((r) => r.startsWith("conversations/70000001/messages?")));
});

Deno.test("a message without its direction or time is a bad row; its text stays out of the error", async () => {
  for (const broken of [{ isIncoming: null }, { date: null, insertedOn: null }, { listingMapId: null }]) {
    const { adapter } = hostawayAdapterOn({
      messages: { "70000001": [hostawayMessage(1, 70000001, "2026-10-14 08:00:00", broken)] },
    });
    const error = await assertRejects(() => adapter.fetchConversation("70000001", SINCE), SignalSourceError);
    assertEquals(error.code, "bad_row");
    assert(!error.message.includes("SYNTH"), error.message);
  }
});

Deno.test("the conversation list ends at the window: later pages are never asked", async () => {
  const conversations = [
    hostawayConversation(1, "2026-10-15 10:00:00"),
    hostawayConversation(2, "2026-10-14 10:00:00"),
    hostawayConversation(3, "2026-10-12 10:00:00"),
    hostawayConversation(4, "2026-10-11 10:00:00"),
    hostawayConversation(5, "2026-10-10 10:00:00"),
    hostawayConversation(6, "2026-10-09 10:00:00"),
    hostawayConversation(7, "2026-10-08 10:00:00"),
  ];
  const { adapter, api } = hostawayAdapterOn({ conversations }, { conversationsPageSize: 2 });
  const active = await adapter.listActiveConversations(SINCE);

  assertEquals(active.map((c) => c.externalConversationId), ["1", "2"]);
  assertEquals(api.requests.length, 2, "a page past the window was asked");
  assertEquals(active[0], {
    externalConversationId: "1",
    lastGuestAt: new Date("2026-10-15T10:00:00Z"),
    externalListingId: "700001",
    externalReservationId: "80000001",
  });
});

Deno.test("the conversation list: nothing personal gets past the fence; a conversation the guest never wrote in keeps the pages going", async () => {
  const conversations = [
    hostawayConversation(1, "2026-10-15 10:00:00"),
    hostawayConversation(2, null),
    hostawayConversation(3, "2026-10-14 10:00:00", { reservationId: null }),
    hostawayConversation(3, "2026-10-14 10:00:00", { reservationId: null }),
    hostawayConversation(4, ""),
  ];
  const { adapter, api } = hostawayAdapterOn({ conversations }, { conversationsPageSize: 2 });
  const active = await adapter.listActiveConversations(SINCE);

  assertEquals(active.map((c) => [c.externalConversationId, c.externalReservationId]), [["1", "80000001"], ["3", null]]);
  assertEquals(api.requests.length, 3);
  const everything = JSON.stringify(active);
  for (const word of HOSTAWAY_GUEST_WORDS) {
    assert(!everything.includes(word), `"${word}" got past the fence`);
  }
});

Deno.test("the fence: only the four fields; a list out of order or with an unreadable time is refused", () => {
  const fence = new ConversationListFence(SINCE);
  assertEquals(fence.cut([hostawayConversation(1, "2026-10-15 10:00:00")]), [
    { id: 1, listingMapId: 700001, reservationId: 80000001, messageReceivedOn: "2026-10-15 10:00:00" },
  ]);
  assertEquals(codeOf(() => fence.cut([hostawayConversation(2, "2026-10-15 11:00:00")])), "filter_ignored");
  assertEquals(
    codeOf(() => new ConversationListFence(SINCE).cut([hostawayConversation(1, "15.10.2026")])),
    "bad_row",
  );
});

Deno.test("one listing of conversations at a time", async () => {
  const { adapter } = hostawayAdapterOn({ conversations: [hostawayConversation(1, "2026-10-15 10:00:00")] });
  const first = adapter.listActiveConversations(SINCE);
  await assertRejects(() => adapter.listActiveConversations(SINCE), Error, "One listing");
  assertEquals((await first).length, 1);
  assertEquals((await adapter.listActiveConversations(SINCE)).length, 1, "the fence was not taken down");
});

Deno.test("the fence touches only the list: a conversation's messages pass as they came", async () => {
  const { adapter } = hostawayAdapterOn({
    conversations: [hostawayConversation(70000001, "2026-10-15 10:00:00")],
    messages: { "70000001": [hostawayMessage(1, 70000001, "2026-10-14 08:00:00")] },
  });
  const [message] = await adapter.fetchConversation("70000001", SINCE);
  assertEquals(message.text, "SYNTH-GUEST-TEXT: there is no hot water in the shower.");
});

Deno.test("the shared client's failures → codes, in the adapter's own words", () => {
  const cases: Array<[unknown, string]> = [
    [new HostawayError("Hostaway returned 429 after 5 attempts (reviews (offset=0))"), "rate_limited"],
    [new HostawayError("Hostaway returned 503 after 5 attempts (reviews (offset=0))"), "unavailable"],
    [new HostawayError("Hostaway returned HTTP 404 for conversations/1/messages"), "unavailable"],
    [new HostawayError("Hostaway authentication failed: HTTP 401"), "auth"],
    [new HostawayError("Hostaway still returns 401 with a fresh token (reviews) — check credentials"), "auth"],
    [new HostawayError("Hostaway rejected request reviews: SYNTH-GUEST-TEXT Synthia"), "unavailable"],
    [new TypeError("error sending request"), "unavailable"],
  ];
  for (const [error, code] of cases) {
    const mapped = toSignalSourceError(error, "Reading");
    assertEquals(mapped.code, code, String(error));
    assert(!mapped.message.includes("SYNTH") && !mapped.message.includes("Synthia"), mapped.message);
    assertEquals(mapped.cause, undefined);
  }
  assertEquals(toSignalSourceError(new HostawayError("Hostaway returned 503 after 5 attempts"), "Reading").message,
    "Reading: Hostaway answered HTTP 503");
});

Deno.test("over the network: 429 is a rate limit, 401 twice refused credentials", async () => {
  const limited = hostawayAdapterOn({ failures: { reviews: { status: 429 } } }).adapter;
  const window = { since: SINCE, until: new Date("2026-10-15T00:00:00Z") };
  assertEquals((await assertRejects(() => limited.fetchReviews(window), SignalSourceError)).code, "rate_limited");
  const refused = hostawayAdapterOn({ failures: { conversations: { status: 401 } } }).adapter;
  assertEquals(
    (await assertRejects(() => refused.listActiveConversations(SINCE), SignalSourceError)).code,
    "auth",
  );
});

Deno.test("a conversation id that is not Hostaway's is refused before anything is asked", async () => {
  const { adapter, api } = hostawayAdapterOn({});
  for (const id of ["", "x", "1/../../reviews"]) {
    const error = await assertRejects(() => adapter.fetchConversation(id, SINCE), SignalSourceError);
    assertEquals(error.code, "bad_row");
  }
  assertEquals(api.requests, []);
});
