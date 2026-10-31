/**
 * The contract between the core of guest signals and a PMS
 * (docs/guest-signals.md §2.2). An adapter knows its PMS; the core knows none.
 *
 * - Every id an adapter hands on is the PMS's own, as a non-empty string. The
 *   core never turns one into ours: the database resolves the place and the
 *   booking itself (resolve_signal_place, resolve_signal_reservation).
 * - Texts and the guest's names travel beside a record, raw, and live only in
 *   the function's memory: the core redacts the texts (redact.ts) and drops
 *   the names.
 * - A failure is a SignalSourceError with a code; its message is the
 *   adapter's own words, never a guest's text or name, never the PMS's answer.
 * - What a PMS can do is stated in `capabilities`, and a method exists exactly
 *   when its capability is on (adapter-contract.ts checks both ways).
 *
 * Two deviations from the sketch in §2.2, on purpose: `fetchReviews` returns
 * the window's reviews at once, with the count of rows that could not be
 * read (`FetchedReviews`), and `listActiveConversations` returns an array —
 * neither as an AsyncIterable. A run reads a bounded window, the PMS pages
 * underneath, and a whole answer is what lets an adapter check the answer
 * against the question (a filter the PMS ignored) before the core sees any
 * of it.
 */

import type { ReviewTexts, SignalChannel } from "./types.ts";

/** The values of public.signal_provider: the PMSs whose signals the database may hold. */
export const STORED_PROVIDERS = ["hostaway"] as const;
export type StoredProvider = (typeof STORED_PROVIDERS)[number];

/** A PMS an adapter speaks for. "fake" is the tests' in-memory PMS (fake-pms.ts) and is never stored. */
export type Provider = StoredProvider | "fake";

/** public.guest_signal_kind. */
export const SIGNAL_KINDS = ["review", "message"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** Where a signal belongs, in the PMS's ids. */
export interface PlaceRef {
  readonly externalListingId: string;
  /** A room inside the listing, when the PMS knows rooms and names one; else null. */
  readonly externalUnitId: string | null;
}

/**
 * A review as ingest_guest_reviews() takes it, without its key and its
 * texts: the PMS's ids only, as strings. Dates are `YYYY-MM-DD`, times ISO
 * 8601 UTC.
 */
export interface NeutralReviewRow {
  /** The PMS's id of the review: the key is made of it (key.ts), the database keeps it while the stay is exact. */
  readonly external_id: string;
  readonly external_listing_id: string;
  /** The room inside the listing. A review list names none; the booking may (namesOf). */
  readonly external_unit_id: string | null;
  readonly external_reservation_id: string | null;
  readonly channel: SignalChannel;
  readonly rating: number | null;
  readonly category_ratings: Readonly<Record<string, number>>;
  readonly arrival_date: string | null;
  readonly departure_date: string | null;
  readonly submitted_at: string;
  readonly is_hidden: boolean;
  readonly has_public_text: boolean;
  readonly has_private_text: boolean;
  readonly has_host_reply: boolean;
  readonly external_updated_at: string | null;
}

/** A review as an adapter read it. `row` carries no text; `texts` and the names live in memory only. */
export interface NeutralReview {
  readonly row: NeutralReviewRow;
  readonly texts: ReviewTexts;
  /** The guest's names as the review gave them: used to strip them from the texts, then dropped. */
  readonly guestNames: readonly string[];
  /** The listing's names in the PMS, stripped from the texts too. */
  readonly listingNames: readonly string[];
}

export interface FetchedReviews {
  readonly reviews: readonly NeutralReview[];
  /** Rows the PMS sent that could not be read; counted, never kept. */
  readonly skipped: number;
}

/** A window of time: `since` included, `until` not. */
export interface TimeWindow {
  readonly since: Date;
  readonly until: Date;
}

export type MessageDirection = "guest" | "host" | "system";

/** One message of a conversation. The text is raw and lives only in the function's memory. */
export interface NeutralMessage {
  /** The PMS's id of the message. */
  readonly externalId: string;
  readonly externalConversationId: string;
  /** When it was sent, in UTC. */
  readonly sentAt: Date;
  readonly direction: MessageDirection;
  /** A template, a scheduler or an auto-reply sent it, not a person. */
  readonly automated: boolean;
  readonly channel: SignalChannel;
  readonly place: PlaceRef;
  readonly externalReservationId: string | null;
  /** Raw; null when the message has no words (an empty body, an attachment alone). */
  readonly text: string | null;
  /** How many files came with it — a count, never the files. */
  readonly attachments: number;
}

/**
 * What a PMS's notification of a new message tells: which message, where,
 * from whom — never its text. For the core it is a reason to read the
 * conversation again (fetchConversation), not the message itself.
 */
export interface NeutralMessageEvent {
  readonly externalId: string;
  readonly externalConversationId: string;
  /** The PMS account that sent the notification, when it says. */
  readonly externalAccountId: string | null;
  readonly sentAt: Date;
  readonly direction: MessageDirection;
  readonly automated: boolean;
  readonly channel: SignalChannel;
  readonly place: PlaceRef;
  readonly externalReservationId: string | null;
}

/** A conversation the guest wrote in lately, as the PMS lists it. */
export interface ActiveConversation {
  readonly externalConversationId: string;
  /** The guest's latest message, in UTC. */
  readonly lastGuestAt: Date;
  readonly externalListingId: string | null;
  readonly externalReservationId: string | null;
}

/** A webhook request as the function received it; the body already parsed. */
export interface WebhookRequest {
  readonly headers: Headers;
  readonly body: unknown;
}

/** What a PMS can do (docs §2.2). A capability that is on has its method; one that is off has none. */
export interface Capabilities {
  readonly reviews: false | { readonly since: boolean; readonly privateText: boolean };
  readonly messages: false | {
    /** The PMS itself calls us about a new guest message. */
    readonly webhook: boolean;
    /** Conversations can be listed by their latest activity. */
    readonly poll: boolean;
    /** A conversation's messages can be read again on demand. */
    readonly fetchConversation: boolean;
    /** Incoming and outgoing messages can be told apart. */
    readonly direction: boolean;
    /** The host's automatic messages are marked. */
    readonly automatedFlag: boolean;
  };
  /** A message and a review know their booking. */
  readonly reservationLink: boolean;
  /** Rooms inside a listing. */
  readonly units: boolean;
  /** A link to the conversation for a manager. */
  readonly conversationUrl: boolean;
}

/** The guest's names of a booking, for the redaction only — in memory, never stored. */
export type NamesResult =
  | {
    readonly status: "ok";
    readonly names: readonly string[];
    /** The one room the booking names inside its listing, else null. */
    readonly externalUnitId: string | null;
  }
  /** The PMS no longer has the booking: gone, not failing — asking again would not help. */
  | { readonly status: "gone" }
  /** It could not be read now: the core holds the signal and asks again. */
  | { readonly status: "unavailable" };

export interface GuestSignalAdapter {
  readonly provider: Provider;
  readonly capabilities: Capabilities;
  /** Published guest reviews sent in the window. */
  fetchReviews?(window: TimeWindow): Promise<FetchedReviews>;
  /** A notification of a new message, or null for any other notification. */
  parseWebhook?(request: WebhookRequest): NeutralMessageEvent | null;
  /** Conversations whose guest wrote at or after `since`, newest first. */
  listActiveConversations?(since: Date): Promise<readonly ActiveConversation[]>;
  /** A conversation's messages sent at or after `since`. */
  fetchConversation?(externalConversationId: string, since: Date): Promise<readonly NeutralMessage[]>;
  /** The guest's names of a booking (and its room), for the redaction, in memory. Never throws. */
  namesOf(externalReservationId: string): Promise<NamesResult>;
  conversationUrl?(externalConversationId: string): string;
}

export const SIGNAL_SOURCE_ERROR_CODES = [
  "unavailable",
  "rate_limited",
  "bad_row",
  "filter_ignored",
  "auth",
] as const;
export type SignalSourceErrorCode = (typeof SIGNAL_SOURCE_ERROR_CODES)[number];

/**
 * A failure of the PMS with a code for the run's journal. The message is the
 * adapter's own sentence: never a guest's text or name, never the PMS's
 * answer, and no cause is attached that could carry one.
 */
export class SignalSourceError extends Error {
  override readonly name = "SignalSourceError";
  constructor(readonly code: SignalSourceErrorCode, message: string) {
    super(message);
  }
}

/** The journal's code of a source failure: `source_<code>`; anything that is not a SignalSourceError is `source_unavailable`. */
export function sourceErrorCode(error: unknown): string {
  return `source_${error instanceof SignalSourceError ? error.code : "unavailable"}`;
}
