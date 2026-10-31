/**
 * A PMS in memory, for tests only (docs/guest-signals.md §2.2): an adapter
 * of provider "fake" over a world of synthetic reviews, conversations and
 * bookings, with the scenarios the core must survive — a repeated webhook,
 * messages out of order, a webhook that never came (polling finds the
 * conversation), an automatic message, a host's message, an empty body, an
 * attachment without words, a booking deleted (`gone`), a failure
 * (`unavailable`), a rate limit, a conversation without a booking, a room
 * inside a listing.
 *
 * Its ids are not numbers on purpose: the core must treat a PMS's ids as
 * opaque strings. Nothing here is a real guest, text or id. No function
 * imports this file.
 */

import {
  type ActiveConversation,
  type Capabilities,
  type FetchedReviews,
  type GuestSignalAdapter,
  type NamesResult,
  type NeutralMessage,
  type NeutralMessageEvent,
  type NeutralReview,
  SignalSourceError,
  type SignalSourceErrorCode,
  type TimeWindow,
  type WebhookRequest,
} from "./adapter.ts";
import { isOneOf, SIGNAL_CHANNELS } from "./types.ts";

export const FAKE_CAPABILITIES: Capabilities = Object.freeze({
  reviews: Object.freeze({ since: true, privateText: true }),
  messages: Object.freeze({
    webhook: true,
    poll: true,
    fetchConversation: true,
    direction: true,
    automatedFlag: true,
  }),
  reservationLink: true,
  units: true,
  conversationUrl: true,
});

export interface FakeConversation {
  readonly id: string;
  /** Kept in the order the PMS would send them — not always the order they were sent in. */
  readonly messages: readonly NeutralMessage[];
}

/** The methods a world can make fail, and with which code. */
export type FakeFailures = Readonly<
  Partial<Record<"fetchReviews" | "listActiveConversations" | "fetchConversation", SignalSourceErrorCode>>
>;

export interface FakeWorld {
  readonly reviews: readonly NeutralReview[];
  /** Rows the PMS sends broken, as fetchReviews counts them. */
  readonly brokenReviews: number;
  readonly conversations: readonly FakeConversation[];
  /** Booking id → what namesOf answers; a booking the world does not know is gone. */
  readonly bookings: Readonly<Record<string, NamesResult>>;
  /** Conversations whose reading the PMS refuses, and with which code (a rate limit, say). */
  readonly refusedConversations: Readonly<Record<string, SignalSourceErrorCode>>;
  readonly failures: FakeFailures;
}

/** The notification the fake PMS sends about a message: its routing fields and, as real ones do, its text. */
export function fakeWebhookBody(message: NeutralMessage): Record<string, unknown> {
  return {
    fake: "message.created",
    message: {
      id: message.externalId,
      conversation: message.externalConversationId,
      listing: message.place.externalListingId,
      unit: message.place.externalUnitId,
      booking: message.externalReservationId,
      from: message.direction,
      automated: message.automated,
      channel: message.channel,
      sentAt: message.sentAt.toISOString(),
      text: message.text,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function refusal(code: SignalSourceErrorCode): SignalSourceError {
  return new SignalSourceError(code, `The fake PMS refused the request (${code})`);
}

/** The guest's latest message of a conversation, if any. */
function lastGuestAt(conversation: FakeConversation): Date | null {
  const times = conversation.messages
    .filter((message) => message.direction === "guest")
    .map((message) => message.sentAt.getTime());
  return times.length === 0 ? null : new Date(Math.max(...times));
}

export class FakePms implements GuestSignalAdapter {
  readonly provider = "fake" as const;
  readonly capabilities: Capabilities = FAKE_CAPABILITIES;

  constructor(readonly world: FakeWorld) {}

  fetchReviews({ since, until }: TimeWindow): Promise<FetchedReviews> {
    const failure = this.world.failures.fetchReviews;
    if (failure !== undefined) {
      return Promise.reject(refusal(failure));
    }
    const reviews = this.world.reviews.filter((review) => {
      const sent = Date.parse(review.row.submitted_at);
      return sent >= since.getTime() && sent < until.getTime();
    });
    return Promise.resolve({ reviews, skipped: this.world.brokenReviews });
  }

  parseWebhook({ body }: WebhookRequest): NeutralMessageEvent | null {
    if (!isRecord(body) || body.fake !== "message.created") {
      return null;
    }
    const message = isRecord(body.message) ? body.message : {};
    const externalId = nonEmpty(message.id);
    const externalConversationId = nonEmpty(message.conversation);
    const externalListingId = nonEmpty(message.listing);
    const sentAt = typeof message.sentAt === "string" ? new Date(message.sentAt) : null;
    const direction = message.from === "guest" || message.from === "host" || message.from === "system"
      ? message.from
      : null;
    if (
      externalId === null || externalConversationId === null || externalListingId === null ||
      sentAt === null || Number.isNaN(sentAt.getTime()) || direction === null
    ) {
      throw refusal("bad_row");
    }
    return {
      externalId,
      externalConversationId,
      externalAccountId: null,
      sentAt,
      direction,
      automated: message.automated === true,
      channel: isOneOf(SIGNAL_CHANNELS, message.channel) ? message.channel : "other",
      place: { externalListingId, externalUnitId: nonEmpty(message.unit) },
      externalReservationId: nonEmpty(message.booking),
    };
  }

  listActiveConversations(since: Date): Promise<readonly ActiveConversation[]> {
    const failure = this.world.failures.listActiveConversations;
    if (failure !== undefined) {
      return Promise.reject(refusal(failure));
    }
    const active = this.world.conversations
      .map((conversation) => ({ conversation, at: lastGuestAt(conversation) }))
      .filter((entry): entry is { conversation: FakeConversation; at: Date } =>
        entry.at !== null && entry.at.getTime() >= since.getTime()
      )
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map(({ conversation, at }) => ({
        externalConversationId: conversation.id,
        lastGuestAt: at,
        externalListingId: conversation.messages[0]?.place.externalListingId ?? null,
        externalReservationId: conversation.messages[0]?.externalReservationId ?? null,
      }));
    return Promise.resolve(active);
  }

  fetchConversation(externalConversationId: string, since: Date): Promise<readonly NeutralMessage[]> {
    const failure = this.world.refusedConversations[externalConversationId] ??
      this.world.failures.fetchConversation;
    if (failure !== undefined) {
      return Promise.reject(refusal(failure));
    }
    const conversation = this.world.conversations.find((c) => c.id === externalConversationId);
    if (conversation === undefined) {
      return Promise.reject(new SignalSourceError("unavailable", "The fake PMS has no such conversation"));
    }
    return Promise.resolve(
      conversation.messages.filter((message) => message.sentAt.getTime() >= since.getTime()),
    );
  }

  namesOf(externalReservationId: string): Promise<NamesResult> {
    return Promise.resolve(this.world.bookings[externalReservationId] ?? { status: "gone" });
  }

  conversationUrl(externalConversationId: string): string {
    return `https://fake-pms.invalid/inbox/${encodeURIComponent(externalConversationId)}`;
  }
}

// ------------------------------------------------------------ the scenario

/** The scenario's moment. */
export const FAKE_NOW = new Date("2026-10-15T12:00:00Z");

/** Synthetic words of the scenario's guests: none may leave an adapter in an error or an event. */
export const FAKE_GUEST_WORDS = [
  "Fakeguest Synthova",
  "Synthova",
  "FAKE-REVIEW-TEXT",
  "FAKE-GUEST-TEXT",
  "FAKE-PRIVATE-TEXT",
] as const;

function message(
  conversation: string,
  id: string,
  sentAt: string,
  overrides: Partial<NeutralMessage> = {},
): NeutralMessage {
  return {
    externalId: id,
    externalConversationId: conversation,
    sentAt: new Date(sentAt),
    direction: "guest",
    automated: false,
    channel: "airbnb",
    place: { externalListingId: "fake-listing-1", externalUnitId: null },
    externalReservationId: "fake-booking-1",
    text: "FAKE-GUEST-TEXT: the shower has no hot water",
    attachments: 0,
    ...overrides,
  };
}

function review(id: string, submittedAt: string, overrides: Partial<NeutralReview["row"]> = {}): NeutralReview {
  return {
    row: {
      external_id: id,
      external_listing_id: "fake-listing-1",
      external_unit_id: null,
      external_reservation_id: "fake-booking-1",
      channel: "booking",
      rating: 7,
      category_ratings: { cleanliness: 8 },
      arrival_date: "2026-10-10",
      departure_date: "2026-10-12",
      submitted_at: submittedAt,
      is_hidden: false,
      has_public_text: true,
      has_private_text: true,
      has_host_reply: false,
      external_updated_at: null,
      ...overrides,
    },
    texts: {
      publicText: "FAKE-REVIEW-TEXT: the kettle did not work.",
      privateText: "FAKE-PRIVATE-TEXT: Fakeguest Synthova here.",
      categoryComments: {},
    },
    guestNames: ["Fakeguest Synthova"],
    listingNames: ["Fake Flat One"],
  };
}

/** The ids the scenario's checks look for. */
export const FAKE_IDS = {
  stay: "fake-conv-stay",
  noBooking: "fake-conv-no-booking",
  room: "fake-conv-room",
  missedWebhook: "fake-conv-missed-webhook",
  limited: "fake-conv-limited",
  old: "fake-conv-old",
  guest: "fake-msg-guest",
  host: "fake-msg-host",
  automated: "fake-msg-auto",
  empty: "fake-msg-empty",
  attachment: "fake-msg-attachment",
  older: "fake-msg-older",
} as const;

/** The world of the scenarios, as of FAKE_NOW. */
export function fakeWorld(overrides: Partial<FakeWorld> = {}): FakeWorld {
  const ids = FAKE_IDS;
  const stay: FakeConversation = {
    id: ids.stay,
    // Out of order: the PMS lists the host's reply before the guest's message it answers.
    messages: [
      message(ids.stay, ids.host, "2026-10-14T08:30:00Z", {
        direction: "host",
        text: "We are sending a technician.",
      }),
      message(ids.stay, ids.guest, "2026-10-14T08:00:00Z"),
      message(ids.stay, ids.automated, "2026-10-13T12:00:00Z", {
        direction: "host",
        automated: true,
        text: "Your check-in details.",
      }),
      message(ids.stay, ids.empty, "2026-10-14T09:00:00Z", { text: null }),
      message(ids.stay, ids.attachment, "2026-10-14T09:05:00Z", { text: null, attachments: 2 }),
      message(ids.stay, ids.older, "2026-10-01T09:00:00Z"),
    ],
  };
  return {
    reviews: [
      review("fake-review-1", "2026-10-13T09:00:00Z"),
      review("fake-review-2", "2026-10-14T09:00:00Z", { is_hidden: true, external_reservation_id: null }),
      review("fake-review-old", "2026-09-01T09:00:00Z"),
    ],
    brokenReviews: 1,
    conversations: [
      stay,
      {
        id: ids.noBooking,
        messages: [message(ids.noBooking, "fake-msg-inquiry", "2026-10-15T07:00:00Z", { externalReservationId: null })],
      },
      {
        id: ids.room,
        messages: [
          message(ids.room, "fake-msg-room", "2026-10-14T20:00:00Z", {
            place: { externalListingId: "fake-building-1", externalUnitId: "fake-room-7" },
            externalReservationId: "fake-booking-room",
          }),
        ],
      },
      {
        // No webhook ever came for it: only polling finds it.
        id: ids.missedWebhook,
        messages: [message(ids.missedWebhook, "fake-msg-missed", "2026-10-14T18:00:00Z")],
      },
      { id: ids.limited, messages: [message(ids.limited, "fake-msg-limited", "2026-10-14T10:00:00Z")] },
      { id: ids.old, messages: [message(ids.old, "fake-msg-old", "2026-09-20T10:00:00Z")] },
    ],
    bookings: {
      "fake-booking-1": { status: "ok", names: ["Fakeguest Synthova"], externalUnitId: null },
      "fake-booking-room": { status: "ok", names: ["Fakeguest Synthova"], externalUnitId: "fake-room-7" },
      "fake-booking-nameless": { status: "ok", names: [], externalUnitId: null },
      "fake-booking-down": { status: "unavailable" },
      "fake-booking-limited": { status: "unavailable" },
    },
    refusedConversations: { [ids.limited]: "rate_limited" },
    failures: {},
    ...overrides,
  };
}
