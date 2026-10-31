/**
 * Hostaway's API on a fake network, for tests only: answers in the live
 * API's shape (field names as docs/guest-signals.md §3.1 and
 * docs/reviews-to-tasks.md §1.1 record them) from a world of synthetic
 * rows, with `limit`/`offset` paging, and the failures a test asks for.
 * No request leaves the process; nothing here is a real guest, text or id.
 * No function imports this file.
 */

import { HostawayAdapter, type HostawayAdapterOptions } from "./hostaway.ts";

type Raw = Record<string, unknown>;

/** An answer instead of the data: an HTTP status, or a refusal (HTTP 200, `status: "fail"`) quoting `result`. */
export type FakeHostawayFailure = { readonly status: number } | { readonly refusal: string };

export interface FakeHostawayWorld {
  readonly reviews?: readonly Raw[];
  /** Newest first, as the live API lists them. */
  readonly conversations?: readonly Raw[];
  /** Conversation id → its messages. */
  readonly messages?: Readonly<Record<string, readonly Raw[]>>;
  /** Booking id → the booking; a booking not here answers 404. */
  readonly reservations?: Readonly<Record<string, Raw>>;
  /** A path without `/v1/` and the query (`reviews`, `reservations/1`) → its failure. */
  readonly failures?: Readonly<Record<string, FakeHostawayFailure>>;
  /** The token endpoint's status; 200 by default. */
  readonly authStatus?: number;
}

export interface FakeHostawayApi {
  readonly fetchImpl: typeof fetch;
  /** Every data request, as `path?query`, in order. */
  readonly requests: readonly string[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function page(items: readonly Raw[], query: URLSearchParams): Response {
  const limit = Number(query.get("limit") ?? "100");
  const offset = Number(query.get("offset") ?? "0");
  return json({
    status: "success",
    result: items.slice(offset, offset + limit),
    limit,
    offset,
    count: items.length,
  });
}

export function fakeHostawayApi(world: FakeHostawayWorld): FakeHostawayApi {
  const requests: string[] = [];
  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/v1\//, "");
    if (path === "accessTokens") {
      const status = world.authStatus ?? 200;
      return Promise.resolve(status === 200 ? json({ access_token: "test-token" }) : json({}, status));
    }
    requests.push(`${path}${url.search}`);

    const failure = world.failures?.[path];
    if (failure !== undefined) {
      return Promise.resolve(
        "status" in failure
          ? json({ status: "fail", result: "synthetic failure" }, failure.status)
          : json({ status: "fail", result: failure.refusal }),
      );
    }
    if (path === "reviews") {
      return Promise.resolve(page(world.reviews ?? [], url.searchParams));
    }
    if (path === "conversations") {
      return Promise.resolve(page(world.conversations ?? [], url.searchParams));
    }
    const messages = /^conversations\/([^/]+)\/messages$/.exec(path);
    if (messages !== null) {
      return Promise.resolve(page(world.messages?.[messages[1]] ?? [], url.searchParams));
    }
    const reservation = /^reservations\/([^/]+)$/.exec(path);
    if (reservation !== null && world.reservations?.[reservation[1]] !== undefined) {
      return Promise.resolve(json({ status: "success", result: world.reservations[reservation[1]] }));
    }
    return Promise.resolve(json({ status: "fail", result: "Not found" }, 404));
  };
  return { fetchImpl: fetchImpl as typeof fetch, requests };
}

/** A HostawayAdapter over the fake network: no pauses between requests or retries. */
export function hostawayAdapterOn(
  world: FakeHostawayWorld,
  options: HostawayAdapterOptions = {},
): { adapter: HostawayAdapter; api: FakeHostawayApi } {
  const api = fakeHostawayApi(world);
  const adapter = new HostawayAdapter(
    { accountId: "1", apiKey: "test-only-key" },
    { sleep: () => Promise.resolve(), now: () => 0, ...options, fetchImpl: api.fetchImpl },
  );
  return { adapter, api };
}

// ---------------------------------------------------- rows in its shape

export function hostawayReview(overrides: Raw = {}): Raw {
  return {
    id: 90000001,
    listingMapId: 700001,
    reservationId: 80000001,
    channelId: 2018,
    type: "guest-to-host",
    status: "published",
    rating: 8,
    reviewCategory: [
      { category: "cleanliness", rating: 10, comment: null },
      { category: "checkin", rating: 6, comment: "SYNTH-COMMENT-TEXT: the key box code was wrong." },
      { category: "respect_house_rules", rating: 10, comment: null },
    ],
    publicReview: "SYNTH-REVIEW-TEXT: nice flat, but the shower had no hot water.",
    privateFeedback: null,
    revieweeResponse: null,
    isHidden: 0,
    submittedAt: "2026-10-15 09:30:00",
    updatedOn: "2026-10-15 09:31:00",
    arrivalDate: "2026-10-10 00:00:00",
    departureDate: "2026-10-13 00:00:00",
    guestName: "Synthia Reviewer",
    reviewerName: "Synthia",
    listingName: "Test Flat A",
    internalListingName: "TF-A",
    externalListingName: "Cosy test flat",
    ...overrides,
  };
}

/** A conversation as the list sends it: the four fields the adapter reads, and personal ones it must not. */
export function hostawayConversation(id: number, receivedOn: string | null, overrides: Raw = {}): Raw {
  return {
    id,
    listingMapId: 700001,
    reservationId: 80000001,
    type: "host-guest-email",
    messageSentOn: receivedOn,
    messageReceivedOn: receivedOn,
    hasUnreadMessages: 0,
    isArchived: 0,
    isSnoozed: 0,
    recipientName: "Synthetic Recipient",
    recipientEmail: "recipient@example.invalid",
    guestEmail: "guest@example.invalid",
    hostEmail: "host@example.invalid",
    recipientPicture: "https://example.invalid/picture.png",
    conversationMessages: [{ id: 1, body: "SYNTH-NESTED-TEXT: the nested message" }],
    Reservation: { id: 80000001, guestName: "Synthia Booker", phone: "+420000000000" },
    ...overrides,
  };
}

export function hostawayMessage(id: number, conversationId: number, date: string, overrides: Raw = {}): Raw {
  return {
    id,
    conversationId,
    reservationId: 80000001,
    listingMapId: 700001,
    isIncoming: 1,
    communicationType: "channel",
    channelId: 2018,
    date,
    insertedOn: date,
    updatedOn: date,
    status: "sent",
    body: "SYNTH-GUEST-TEXT: there is no hot water in the shower.",
    attachments: [],
    imagesUrls: [],
    isSeen: 1,
    hash: "synthetic-hash",
    userId: null,
    communicationId: null,
    communicationEvent: null,
    communicationAlwaysTrigger: null,
    communicationTimeDeltaSeconds: null,
    sentUsingHostaway: 0,
    ...overrides,
  };
}

/** A unified webhook about a new message, as Hostaway sends it (body and all). */
export function hostawayMessageWebhook(message: Raw): Raw {
  return {
    object: "conversationMessage",
    event: "message.received",
    objectId: message.id,
    accountId: 12345,
    data: message,
  };
}

/** Synthetic words of the rows above: none may leave the adapter in an error, an event or a list. */
export const HOSTAWAY_GUEST_WORDS = [
  "SYNTH-REVIEW-TEXT",
  "SYNTH-COMMENT-TEXT",
  "SYNTH-GUEST-TEXT",
  "SYNTH-NESTED-TEXT",
  "Synthia",
  "Reviewer",
  "Booker",
  "Synthetic Recipient",
  "example.invalid",
  "+420000000000",
] as const;
