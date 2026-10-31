import { assert, assertEquals, assertFalse, assertStrictEquals } from "jsr:@std/assert@1";
import {
  isGuestMessageEvent,
  journalPayload,
  journalUnparsed,
  MESSAGE_DATA_KEYS,
  MESSAGE_EVENT,
  MESSAGE_IN_RAW_TEXT,
  MESSAGE_OBJECT,
  MESSAGE_TOP_LEVEL_KEYS,
  minimizeGuestMessage,
} from "./guest-message.ts";

// Synthetic values only. The shape is the live message.received notification
// (field names read on 2026-10-31, docs/guest-signals.md §3.2), plus the guest
// fields a conversation carries, to prove that none of them survives.
const TEXT = "Synthetic text: the heating is off, call me at +000 000 000 or guest@example.test";
const GUEST_NAME = "Testing Guestname";

const MESSAGE_EVENT_PAYLOAD = {
  object: "conversationMessage",
  event: "message.received",
  accountId: 10001,
  guestName: GUEST_NAME,
  data: {
    id: 900001,
    accountId: 10001,
    conversationId: 800001,
    reservationId: 700001,
    listingMapId: 600001,
    isIncoming: 1,
    communicationType: "channel",
    channelId: 2018,
    date: "2026-10-31 12:00:00",
    insertedOn: "2026-10-31 12:00:01",
    updatedOn: "2026-10-31 12:00:01",
    sentChannelDate: null,
    listingTimeZoneName: "Europe/Prague",
    body: TEXT,
    attachments: [{ url: "https://example.test/attachment.jpg", name: "photo.jpg" }],
    imagesUrls: ["https://example.test/image.jpg"],
    hash: "synthetic-hash",
    status: "sent",
    isSeen: 0,
    sentUsingHostaway: 0,
    userId: null,
    communicationId: null,
    communicationEvent: null,
    bookingcomSubthreadId: "synthetic-subthread",
    channelThreadMessageId: "synthetic-thread-message",
    recipientName: GUEST_NAME,
    guestEmail: "guest@example.test",
    guestPhone: "+000 000 000",
  },
};

const EXPECTED_MINIMAL = {
  object: "conversationMessage",
  event: "message.received",
  accountId: 10001,
  data: {
    id: 900001,
    conversationId: 800001,
    reservationId: 700001,
    listingMapId: 600001,
    isIncoming: 1,
    communicationType: "channel",
    channelId: 2018,
    date: "2026-10-31 12:00:00",
    insertedOn: "2026-10-31 12:00:01",
    updatedOn: "2026-10-31 12:00:01",
    sentChannelDate: null,
    listingTimeZoneName: "Europe/Prague",
  },
};

const RESERVATION_EVENT_PAYLOAD = {
  object: "reservation",
  event: "reservation.updated",
  accountId: 10001,
  data: { id: 700001, guestName: GUEST_NAME, guestEmail: "guest@example.test", arrivalDate: "2026-11-01" },
};

// ---------------------------------------------------------------------------
//  A message keeps the listed fields and nothing else
// ---------------------------------------------------------------------------

Deno.test("a message keeps exactly the listed fields", () => {
  assertEquals(minimizeGuestMessage(MESSAGE_EVENT_PAYLOAD), EXPECTED_MINIMAL);
});

Deno.test("a kept message carries no text, attachment, name, e-mail or phone", () => {
  const kept = JSON.stringify(journalPayload(MESSAGE_EVENT_PAYLOAD));

  for (const gone of [TEXT, GUEST_NAME, "guest@example.test", "+000 000 000", "example.test/attachment", "image.jpg"]) {
    assertFalse(kept.includes(gone), `the journal must not keep: ${gone}`);
  }
});

Deno.test("the message id stays, so record_webhook_event still finds the object id", () => {
  const kept = journalPayload(MESSAGE_EVENT_PAYLOAD) as { data: { id: number } };

  assertEquals(kept.data.id, 900001);
});

Deno.test("a listed key with a nested value is dropped, not kept", () => {
  const kept = minimizeGuestMessage({
    object: "conversationMessage",
    event: { name: GUEST_NAME },
    data: { id: 1, reservationId: { guestName: GUEST_NAME }, date: ["2026-10-31"] },
  });

  assertEquals(kept, { object: "conversationMessage", data: { id: 1 } });
});

Deno.test("data that is not an object is left out", () => {
  assertEquals(minimizeGuestMessage({ object: "conversationMessage", data: TEXT }), {
    object: "conversationMessage",
  });
  assertEquals(minimizeGuestMessage({ event: "message.received" }), { event: "message.received" });
});

// ---------------------------------------------------------------------------
//  What counts as a message, and that nothing else changes
// ---------------------------------------------------------------------------

Deno.test("message notifications are told by their object or their event", () => {
  assert(isGuestMessageEvent({ object: "conversationMessage", event: "message.received" }));
  assert(isGuestMessageEvent({ object: "something", event: "message.updated" }));
  assert(isGuestMessageEvent({ event: "conversationMessage.created" }));
  assert(isGuestMessageEvent({ object: "Message" }));
});

Deno.test("reservations, tasks and other shapes are not messages", () => {
  assertFalse(isGuestMessageEvent({ object: "reservation", event: "reservation.created" }));
  assertFalse(isGuestMessageEvent({ object: "task", event: "task.updated" }));
  assertFalse(isGuestMessageEvent({ object: "somethingNew", event: "future.event" }));
  assertFalse(isGuestMessageEvent(null));
  assertFalse(isGuestMessageEvent([{ object: "conversationMessage" }]));
  assertFalse(isGuestMessageEvent("message.received"));
});

Deno.test("a reservation notification is stored exactly as it came, the same object", () => {
  assertStrictEquals(journalPayload(RESERVATION_EVENT_PAYLOAD), RESERVATION_EVENT_PAYLOAD);
  assertEquals(journalPayload(RESERVATION_EVENT_PAYLOAD), structuredClone(RESERVATION_EVENT_PAYLOAD));
});

Deno.test("anything that is not an object is stored as it came", () => {
  assertStrictEquals(journalPayload(null), null);
  const list = [1, 2];
  assertStrictEquals(journalPayload(list), list);
});

// ---------------------------------------------------------------------------
//  A body that did not parse
// ---------------------------------------------------------------------------

Deno.test("an unparsed body that looks like a message keeps only its length", () => {
  const raw = `{"object":"conversationMessage","event":"message.received","data":{"body":"${TEXT}"`;
  const kept = journalUnparsed(raw, "application/json");

  assertEquals(kept, {
    unparsed: null,
    unparsedLength: raw.length,
    contentType: "application/json",
    withheld: "guest_message",
  });
  assertFalse(JSON.stringify(kept).includes(TEXT));
});

Deno.test("any other unparsed body is kept for a look by hand", () => {
  assertEquals(journalUnparsed("{not json", "text/plain"), { unparsed: "{not json", contentType: "text/plain" });
});

// ---------------------------------------------------------------------------
//  The SQL files write the same lists and the same test
// ---------------------------------------------------------------------------

const SQL_FILES = [
  "../../../docs/one-off-writes/guest-message-bodies-wipe.sql",
  "../../../docs/rollout/guest_message_intake_probe.sql",
];

function keyList(sql: string, name: "keep_top" | "keep_data"): string[] {
  const block = sql.match(new RegExp(`${name}\\(k\\) as \\(([\\s\\S]*?)\\n\\),`));
  assert(block, `${name} not found`);
  return [...block[1].matchAll(/\('([A-Za-z]+)'\)/g)].map((match) => match[1]);
}

for (const file of SQL_FILES) {
  Deno.test(`${file.split("/").pop()} keeps the same fields as the intake`, async () => {
    const sql = await Deno.readTextFile(new URL(file, import.meta.url));

    assertEquals(keyList(sql, "keep_top"), [...MESSAGE_TOP_LEVEL_KEYS]);
    assertEquals(keyList(sql, "keep_data"), [...MESSAGE_DATA_KEYS]);
    assert(sql.includes(`object_type ~* '${MESSAGE_OBJECT.source}'`), "the object test differs");
    assert(sql.includes(`event_type ~* '${MESSAGE_EVENT.source}'`), "the event test differs");
  });
}

Deno.test("the wipe looks for unparsed messages with the intake's words", async () => {
  const sql = await Deno.readTextFile(new URL(SQL_FILES[0], import.meta.url));

  assert(sql.includes(`~* '${MESSAGE_IN_RAW_TEXT.source}'`), "the unparsed test differs");
});
