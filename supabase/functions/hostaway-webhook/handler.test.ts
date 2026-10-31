import { assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { buildBasicAuthHeader } from "../_shared/basic-auth.ts";
import { ConfigError } from "../_shared/env.ts";
import { createWebhookHandler } from "./handler.ts";

const CREDENTIALS = { login: "hostaway-hook", password: "s3cret-p@ss" } as const;
const AUTH = buildBasicAuthHeader(CREDENTIALS.login, CREDENTIALS.password);

const RESERVATION_EVENT = {
  object: "reservation",
  objectId: 65289672,
  event: "reservation.created",
};

function makeHandler(options: { credentialsError?: Error; recordError?: Error } = {}) {
  const recorded: unknown[] = [];
  let nextId = 1;

  const handler = createWebhookHandler({
    loadCredentials: () => {
      if (options.credentialsError) throw options.credentialsError;
      return CREDENTIALS;
    },
    recordEvent: (payload: unknown) => {
      if (options.recordError) return Promise.reject(options.recordError);
      recorded.push(payload);
      return Promise.resolve(nextId++);
    },
  });

  return { handler, recorded };
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/functions/v1/hostaway-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
//  The happy path
// ---------------------------------------------------------------------------

Deno.test("valid request: 200 and the event in the journal", async () => {
  const { handler, recorded } = makeHandler();

  const response = await handler(request(RESERVATION_EVENT, { Authorization: AUTH }));

  assertEquals(response.status, 200);
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0], RESERVATION_EVENT);
});

Deno.test("an unknown event type is still accepted", async () => {
  // Hostaway's documentation: "if you receive a webhook with an event that you
  // don't support yet, just return a 200 response".
  const { handler, recorded } = makeHandler();

  const response = await handler(
    request({ object: "somethingNew", objectId: 1, event: "future.event" }, { Authorization: AUTH }),
  );

  assertEquals(response.status, 200);
  assertEquals(recorded.length, 1, "an unknown event has to be kept as well");
});

// ---------------------------------------------------------------------------
//  Guest messages: kept without text or contacts; everything else as it came
// ---------------------------------------------------------------------------

const GUEST_TEXT = "Synthetic text: no hot water, write to guest@example.test";

Deno.test("a guest message reaches the journal without its text and contacts", async () => {
  const { handler, recorded } = makeHandler();
  const delivery = {
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
      channelId: 2005,
      date: "2026-10-31 12:00:00",
      insertedOn: "2026-10-31 12:00:01",
      body: GUEST_TEXT,
      attachments: [],
      recipientName: "Testing Guestname",
    },
  };

  const response = await handler(request(delivery, { Authorization: AUTH }));

  assertEquals(response.status, 200);
  assertEquals(recorded[0], {
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
      channelId: 2005,
      date: "2026-10-31 12:00:00",
      insertedOn: "2026-10-31 12:00:01",
    },
  });
});

Deno.test("a reservation with guest details is kept whole: its processing reads it as before", async () => {
  const { handler, recorded } = makeHandler();
  const delivery = {
    object: "reservation",
    event: "reservation.updated",
    accountId: 10001,
    data: { id: 700001, guestName: "Testing Guestname", guestEmail: "guest@example.test", status: "new" },
  };

  await handler(request(delivery, { Authorization: AUTH }));

  assertEquals(recorded[0], delivery);
});

Deno.test("an unparsed guest message keeps only its length", async () => {
  const { handler, recorded } = makeHandler();
  const broken = `{"object":"conversationMessage","event":"message.received","data":{"body":"${GUEST_TEXT}"`;

  const response = await handler(request(broken, { Authorization: AUTH }));

  assertEquals(response.status, 200);
  assertFalse(JSON.stringify(recorded[0]).includes(GUEST_TEXT), "the text must not reach the journal");
});

// ---------------------------------------------------------------------------
//  Authorisation refusals: 401, never retried — and rightly so
// ---------------------------------------------------------------------------

Deno.test("no header: 401 and nothing recorded", async () => {
  const { handler, recorded } = makeHandler();

  const response = await handler(request(RESERVATION_EVENT));

  assertEquals(response.status, 401);
  assertEquals(recorded.length, 0, "an unauthorised event must not reach the journal");
});

Deno.test("wrong password: 401", async () => {
  const { handler, recorded } = makeHandler();
  const wrong = buildBasicAuthHeader(CREDENTIALS.login, "wrong-password");

  const response = await handler(request(RESERVATION_EVENT, { Authorization: wrong }));

  assertEquals(response.status, 401);
  assertEquals(recorded.length, 0);
});

Deno.test("broken header: 401", async () => {
  const { handler } = makeHandler();

  const response = await handler(request(RESERVATION_EVENT, { Authorization: "Bearer abc" }));

  assertEquals(response.status, 401);
});

Deno.test("a 401 answer carries WWW-Authenticate", async () => {
  const { handler } = makeHandler();

  const response = await handler(request(RESERVATION_EVENT));

  assertStringIncludes(response.headers.get("WWW-Authenticate") ?? "", "Basic");
});

// ---------------------------------------------------------------------------
//  Our own failures: 500, because Hostaway retries a 5xx
// ---------------------------------------------------------------------------

Deno.test("secrets not configured: 500, NOT 401", async () => {
  // The key case. A secret forgotten at deployment is our fault and has to be
  // retryable: Hostaway asks again within the hour after a 5xx, while a 4xx
  // would drop the reservation for good.
  const { handler, recorded } = makeHandler({
    credentialsError: new ConfigError("Environment variables are not set: HOSTAWAY_WEBHOOK_LOGIN"),
  });

  const response = await handler(request(RESERVATION_EVENT, { Authorization: AUTH }));

  assertEquals(response.status, 500);
  assertEquals(recorded.length, 0);
});

Deno.test("secrets not configured and no header: still 500", async () => {
  // The configuration is checked BEFORE the header, otherwise a deployment
  // without secrets would pass for an unauthorised request.
  const { handler } = makeHandler({ credentialsError: new ConfigError("no secrets") });

  const response = await handler(request(RESERVATION_EVENT));

  assertEquals(response.status, 500);
});

Deno.test("the journal write failed: 500", async () => {
  // A transient database failure. Hostaway retries — the event is not lost.
  const { handler } = makeHandler({ recordError: new Error("connection reset") });

  const response = await handler(request(RESERVATION_EVENT, { Authorization: AUTH }));

  assertEquals(response.status, 500);
});

// ---------------------------------------------------------------------------
//  An unreadable body: accepted and kept as it is
// ---------------------------------------------------------------------------

Deno.test("invalid JSON: 200 and the raw text in the journal", async () => {
  // A retry would not fix it, but it must not be lost either: kept as it is,
  // to be looked into by hand.
  const { handler, recorded } = makeHandler();

  const response = await handler(request("{this is not json", { Authorization: AUTH }));

  assertEquals(response.status, 200);
  assertEquals(recorded.length, 1);
  const payload = recorded[0] as Record<string, unknown>;
  assertEquals(typeof payload.unparsed, "string");
  assertStringIncludes(payload.unparsed as string, "this is not json");
});

Deno.test("empty body: 200 and a mark in the journal", async () => {
  const { handler, recorded } = makeHandler();

  const response = await handler(request("", { Authorization: AUTH }));

  assertEquals(response.status, 200);
  assertEquals(recorded.length, 1);
});

// ---------------------------------------------------------------------------
//  The rest
// ---------------------------------------------------------------------------

Deno.test("a non-POST is refused with 405", async () => {
  const { handler, recorded } = makeHandler();

  const response = await handler(
    new Request("https://example.test/functions/v1/hostaway-webhook", {
      method: "GET",
      headers: { Authorization: AUTH },
    }),
  );

  assertEquals(response.status, 405);
  assertEquals(recorded.length, 0);
});

Deno.test("the answer is short: an acknowledgement and the record number", async () => {
  // Hostaway waits 20 seconds for the acknowledgement; processing runs
  // separately, so the answer must be short.
  const { handler } = makeHandler();

  const response = await handler(request(RESERVATION_EVENT, { Authorization: AUTH }));
  const body = await response.json();

  assertEquals(body.accepted, true);
  assertEquals(typeof body.eventId, "number");
});
