/**
 * The Hostaway adapter of guest signals (docs/guest-signals.md §2.2, §3;
 * docs/reviews-to-tasks.md §2.4): reviews, messages and the names of a
 * booking, as the neutral records of adapter.ts. The PMS's ids go on as
 * strings; which of our places and bookings they are, the database decides.
 *
 * It reads through the shared client (`_shared/hostaway.ts`, not changed for
 * this — other deployed functions bundle it): `listAll` for lists, `getObject`
 * for a booking. Only GET requests reach Hostaway.
 *
 * Hostaway quietly ignores a parameter it does not know, so the adapter
 * checks the answer against the question: a review of another type or sent
 * before the window, a conversation list that is not newest first, a message
 * of another conversation — the run stops with `filter_ignored` rather than
 * load the wrong thing.
 *
 * The conversation list is personal data in every item (recipientName,
 * guestEmail, the nested messages and booking, docs §3.1), and the client's
 * `listAll` reads every page to the end (33 599 conversations). So the
 * adapter hands its client a fetch with a fence on that one list
 * (ConversationListFence): each page is cut down to id, listingMapId,
 * reservationId and messageReceivedOn the moment it arrives, its order is
 * checked, and the page is cut at the first conversation older than the
 * window, which ends `listAll` there. Nothing else of an item is ever read.
 */

import {
  HostawayClient,
  type HostawayClientOptions,
  type HostawayCredentials,
  HostawayError,
} from "../hostaway.ts";
import {
  type ActiveConversation,
  type Capabilities,
  type FetchedReviews,
  type GuestSignalAdapter,
  type MessageDirection,
  type NamesResult,
  type NeutralMessage,
  type NeutralMessageEvent,
  type NeutralReview,
  type NeutralReviewRow,
  SignalSourceError,
  type TimeWindow,
  type WebhookRequest,
} from "./adapter.ts";
import { CATEGORY_KEYS, isOneOf, type SignalChannel } from "./types.ts";

export const HOSTAWAY_PROVIDER = "hostaway" as const;

export const REVIEWS_ENDPOINT = "reviews";
export const CONVERSATIONS_ENDPOINT = "conversations";

/** One page holds a normal day of reviews many times over (≈ 12 a day, reviews doc §1.2). */
export const REVIEWS_PAGE_SIZE = 500;
/** A page of conversations: each carries its nested messages and booking, so pages stay small. */
export const CONVERSATIONS_PAGE_SIZE = 50;
export const MESSAGES_PAGE_SIZE = 100;

/**
 * What Hostaway can do (docs §2.2, §3). `conversationUrl` stays off: the
 * form of a link into Hostaway's inbox is not verified, and a wrong link
 * would send a manager to another conversation — the owner is asked first.
 */
export const HOSTAWAY_CAPABILITIES: Capabilities = Object.freeze({
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
  conversationUrl: false,
});

/** Hostaway's channel ids, as the account uses them (reviews doc §1.1, this doc §3.1). */
const CHANNEL_BY_ID: Readonly<Record<number, SignalChannel>> = {
  2018: "airbnb",
  2005: "booking",
  2002: "vrbo",
  2000: "direct",
  // The booking engine is the company's own site: a direct booking.
  2013: "direct",
  2022: "google",
};

/** A Hostaway id as it may go into a path: digits, no sign, no zero in front. */
const HOSTAWAY_ID = /^[1-9]\d{0,17}$/;

/**
 * How the shared client words its failures (`_shared/hostaway.ts`). Only
 * these known shapes are read, and only for a code: the words of an error
 * never go further, since a refusal quotes Hostaway's answer.
 */
const CLIENT_STATUS = /^Hostaway returned (?:HTTP )?(\d{3})\b/;
const CLIENT_AUTH = /^Hostaway (?:authentication failed|still returns 401|auth response has no access_token)/;
const BOOKING_GONE = 404;
const RATE_LIMITED = 429;

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveInteger(value: unknown): number | null {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A Hostaway id (a positive integer, or one written as text) as the string the core takes. */
function idText(value: unknown): string | null {
  const n = positiveInteger(value);
  return n === null ? null : String(n);
}

function rating(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10
    ? value
    : null;
}

function channelOf(value: unknown): SignalChannel {
  const id = positiveInteger(value);
  return (id !== null ? CHANNEL_BY_ID[id] : undefined) ?? "other";
}

/** "2026-10-15 12:34:56" (UTC, as Hostaway writes it) → "2026-10-15T12:34:56Z"; anything else → null. */
export function parseHostawayTime(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value.trim());
  if (match === null) {
    return null;
  }
  const iso = `${match[1]}T${match[2]}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** "2026-10-15 00:00:00" or "2026-10-15" → "2026-10-15"; anything else → null. */
export function parseHostawayDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match !== null && !Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`)) ? match[1] : null;
}

/** The day of a moment in UTC, as `submittedAtStart` takes it. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function names(...values: unknown[]): string[] {
  return values.map(text).filter((value): value is string => value !== null);
}

/**
 * A failure of the shared client → a code. Only the client's own shapes are
 * read, for the HTTP status; the message is written here.
 */
export function toSignalSourceError(error: unknown, what: string): SignalSourceError {
  if (error instanceof SignalSourceError) {
    return error;
  }
  if (!(error instanceof HostawayError)) {
    return new SignalSourceError("unavailable", `${what}: Hostaway could not be reached`);
  }
  if (CLIENT_AUTH.test(error.message)) {
    return new SignalSourceError("auth", `${what}: Hostaway refused the credentials`);
  }
  const status = CLIENT_STATUS.exec(error.message)?.[1];
  if (status === String(RATE_LIMITED)) {
    return new SignalSourceError("rate_limited", `${what}: Hostaway kept answering 429 after the retries`);
  }
  return new SignalSourceError(
    "unavailable",
    status !== undefined ? `${what}: Hostaway answered HTTP ${status}` : `${what}: Hostaway did not answer as asked`,
  );
}

function isClientStatus(error: unknown, status: number): boolean {
  return error instanceof HostawayError && CLIENT_STATUS.exec(error.message)?.[1] === String(status);
}

// ---------------------------------------------------------------- reviews

function categories(raw: Raw): { ratings: Record<string, number>; comments: Record<string, string> } {
  const ratings: Record<string, number> = {};
  const comments: Record<string, string> = {};
  const list = Array.isArray(raw.reviewCategory) ? raw.reviewCategory : [];
  for (const entry of list) {
    if (!isRecord(entry) || !isOneOf(CATEGORY_KEYS, entry.category)) {
      continue;
    }
    const value = rating(entry.rating);
    if (value !== null) {
      ratings[entry.category] = value;
    }
    const comment = text(entry.comment);
    if (comment !== null) {
      comments[entry.category] = comment;
    }
  }
  return { ratings, comments };
}

/**
 * One Hostaway review → the neutral row, its texts and the names to strip.
 * Throws SignalSourceError(bad_row) for a row the database could not key (no
 * id, no listing, no time it was sent): it is counted and skipped, never
 * guessed. The list names no room: the booking does (namesOf).
 */
export function normalizeHostawayReview(raw: unknown): NeutralReview {
  if (!isRecord(raw)) {
    throw new SignalSourceError("bad_row", "A review is not an object");
  }
  const id = idText(raw.id);
  const listing = idText(raw.listingMapId);
  const submittedAt = parseHostawayTime(raw.submittedAt);
  if (id === null || listing === null || submittedAt === null) {
    throw new SignalSourceError("bad_row", "A review has no id, listing or submission time");
  }

  const { ratings, comments } = categories(raw);
  const publicText = text(raw.publicReview);
  const privateText = text(raw.privateFeedback);

  const row: NeutralReviewRow = {
    external_id: id,
    external_listing_id: listing,
    external_unit_id: null,
    external_reservation_id: idText(raw.reservationId),
    channel: channelOf(raw.channelId),
    rating: rating(raw.rating),
    category_ratings: ratings,
    arrival_date: parseHostawayDate(raw.arrivalDate),
    departure_date: parseHostawayDate(raw.departureDate),
    submitted_at: submittedAt,
    is_hidden: raw.isHidden === 1 || raw.isHidden === true,
    has_public_text: publicText !== null,
    has_private_text: privateText !== null,
    has_host_reply: text(raw.revieweeResponse) !== null,
    external_updated_at: parseHostawayTime(raw.updatedOn),
  };

  return {
    row,
    texts: { publicText, privateText, categoryComments: comments },
    guestNames: names(raw.guestName, raw.reviewerName),
    listingNames: names(raw.listingName, raw.internalListingName, raw.externalListingName),
  };
}

// --------------------------------------------------------------- messages

function directionOf(value: unknown): MessageDirection | null {
  if (value === 1 || value === true || value === "1") {
    return "guest";
  }
  if (value === 0 || value === false || value === "0") {
    return "host";
  }
  return null;
}

/** Files of a message: `attachments` and `imagesUrls`, counted; neither is ever read further. */
function attachmentCount(raw: Raw): number {
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  return count(raw.attachments) + count(raw.imagesUrls);
}

interface MessageFields {
  readonly externalId: string;
  readonly externalConversationId: string;
  readonly sentAt: Date;
  readonly direction: MessageDirection;
  readonly automated: boolean;
  readonly channel: SignalChannel;
  readonly externalListingId: string;
  readonly externalReservationId: string | null;
}

/**
 * The routing fields of a Hostaway message, from the API or a webhook's
 * `data` (the same field names, docs §3.1–§3.2). Never the body: the caller
 * reads it only where the text is wanted. Throws bad_row for a message that
 * cannot be placed or timed, and filter_ignored for one of another
 * conversation than asked.
 */
function messageFields(raw: unknown, expectedConversationId: string | null): MessageFields {
  if (!isRecord(raw)) {
    throw new SignalSourceError("bad_row", "A message is not an object");
  }
  const externalId = idText(raw.id);
  const externalConversationId = idText(raw.conversationId);
  const externalListingId = idText(raw.listingMapId);
  const direction = directionOf(raw.isIncoming);
  // `insertedOn` first: it is UTC — the webhook comes seconds after it (docs
  // §3.2). `date` (when the channel says it was sent) is only the fallback:
  // its zone is not verified, and the notification also carries the
  // listing's time zone. Seconds apart matter nothing; an hour would.
  const sentAt = parseHostawayTime(raw.insertedOn) ?? parseHostawayTime(raw.date);
  if (
    externalId === null || externalConversationId === null || externalListingId === null ||
    direction === null || sentAt === null
  ) {
    throw new SignalSourceError(
      "bad_row",
      "A message has no id, conversation, listing, direction or time",
    );
  }
  if (expectedConversationId !== null && externalConversationId !== expectedConversationId) {
    throw new SignalSourceError("filter_ignored", "Hostaway answered with a message of another conversation");
  }
  return {
    externalId,
    externalConversationId,
    sentAt: new Date(sentAt),
    direction,
    // A message a template or the scheduler sent carries its communication
    // (docs §3.1). Only the host's side is ever automatic: a guest's message
    // is never set aside as one.
    automated: direction === "host" &&
      (positiveInteger(raw.communicationId) !== null || text(raw.communicationEvent) !== null),
    channel: channelOf(raw.channelId),
    externalListingId,
    externalReservationId: idText(raw.reservationId),
  };
}

function neutralMessage(raw: unknown, conversationId: string): NeutralMessage {
  const fields = messageFields(raw, conversationId);
  const record = raw as Raw;
  return {
    externalId: fields.externalId,
    externalConversationId: fields.externalConversationId,
    sentAt: fields.sentAt,
    direction: fields.direction,
    automated: fields.automated,
    channel: fields.channel,
    place: { externalListingId: fields.externalListingId, externalUnitId: null },
    externalReservationId: fields.externalReservationId,
    text: text(record.body),
    attachments: attachmentCount(record),
  };
}

/** A unified webhook about a conversation message (the shape hostaway-webhook/guest-message.ts keeps). */
function isMessageNotification(body: Raw): boolean {
  const object = typeof body.object === "string" ? body.object.toLowerCase() : "";
  const event = typeof body.event === "string" ? body.event.toLowerCase() : "";
  return object === "conversationmessage" || event === "message.received";
}

// ------------------------------------------------- the conversation list

/** The four fields of a listed conversation the adapter reads (docs §3.1). */
interface ListedConversation {
  readonly id: unknown;
  readonly listingMapId: unknown;
  readonly reservationId: unknown;
  readonly messageReceivedOn: unknown;
}

/** Absent, null or blank: the guest never wrote in this conversation. */
function receivedOn(value: unknown): unknown {
  return value === undefined || (typeof value === "string" && value.trim() === "") ? null : value;
}

function listedConversation(item: unknown): ListedConversation {
  const raw = isRecord(item) ? item : {};
  return {
    id: raw.id ?? null,
    listingMapId: raw.listingMapId ?? null,
    reservationId: raw.reservationId ?? null,
    messageReceivedOn: receivedOn(raw.messageReceivedOn),
  };
}

/**
 * One listing of conversations, between the client and the network: every
 * page is cut down to the four fields as it arrives; the guest's latest
 * message must never be later than the one listed before it (the list is
 * newest first by that field — what the live API does, not what it
 * promises); the page ends at the first conversation older than `since`.
 * A page cut short is the client's sign that it was the last.
 *
 * A conversation the guest never wrote in (messageReceivedOn null) stays in
 * its place, so a page keeps its length and the client reads on; the
 * adapter drops it afterwards.
 */
export class ConversationListFence {
  readonly #since: number;
  #previous: string | null = null;

  constructor(since: Date) {
    this.#since = since.getTime();
  }

  /** One page's items → the items the client may see. Throws for a list in the wrong order. */
  cut(items: readonly unknown[]): ListedConversation[] {
    const kept: ListedConversation[] = [];
    for (const item of items) {
      const listed = listedConversation(item);
      if (listed.messageReceivedOn !== null) {
        const received = parseHostawayTime(listed.messageReceivedOn);
        if (received === null) {
          throw new SignalSourceError("bad_row", "A conversation has an unreadable time of its guest's message");
        }
        if (this.#previous !== null && received > this.#previous) {
          throw new SignalSourceError(
            "filter_ignored",
            "Hostaway did not list the conversations newest first",
          );
        }
        this.#previous = received;
        if (Date.parse(received) < this.#since) {
          break;
        }
      }
      kept.push(listed);
    }
    return kept;
  }
}

function isConversationList(input: string | URL | Request): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(url).pathname.endsWith(`/${CONVERSATIONS_ENDPOINT}`);
  } catch {
    return false;
  }
}

/** A list page through the fence: an answer that is not a list of conversations passes as it came. */
async function fencedPage(response: Response, fence: ConversationListFence): Promise<Response> {
  if (!response.ok) {
    return response;
  }
  const body = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response(body, { status: response.status, headers: response.headers });
  }
  if (!isRecord(payload) || payload.status === "fail" || !Array.isArray(payload.result)) {
    return new Response(body, { status: response.status, headers: response.headers });
  }
  const result = fence.cut(payload.result);
  return new Response(JSON.stringify({ status: payload.status, result }), {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}

function activeConversation(listed: ListedConversation): ActiveConversation | null {
  const externalConversationId = idText(listed.id);
  if (externalConversationId === null) {
    throw new SignalSourceError("bad_row", "A listed conversation has no id");
  }
  const received = parseHostawayTime(listed.messageReceivedOn);
  if (received === null) {
    return null;
  }
  return {
    externalConversationId,
    lastGuestAt: new Date(received),
    externalListingId: idText(listed.listingMapId),
    externalReservationId: idText(listed.reservationId),
  };
}

// ---------------------------------------------------------------- adapter

export interface HostawayAdapterOptions extends HostawayClientOptions {
  readonly reviewsPageSize?: number;
  readonly conversationsPageSize?: number;
  readonly messagesPageSize?: number;
}

export class HostawayAdapter implements GuestSignalAdapter {
  readonly provider = HOSTAWAY_PROVIDER;
  readonly capabilities: Capabilities = HOSTAWAY_CAPABILITIES;
  readonly #client: HostawayClient;
  readonly #reviewsPageSize: number;
  readonly #conversationsPageSize: number;
  readonly #messagesPageSize: number;
  /** The listing of conversations in progress, if any: its fence sees the list's pages. */
  #fence: ConversationListFence | null = null;

  constructor(credentials: HostawayCredentials, options: HostawayAdapterOptions = {}) {
    const { reviewsPageSize, conversationsPageSize, messagesPageSize, fetchImpl, ...client } = options;
    const network: typeof fetch = fetchImpl ?? ((input, init) => fetch(input, init));
    this.#reviewsPageSize = reviewsPageSize ?? REVIEWS_PAGE_SIZE;
    this.#conversationsPageSize = conversationsPageSize ?? CONVERSATIONS_PAGE_SIZE;
    this.#messagesPageSize = messagesPageSize ?? MESSAGES_PAGE_SIZE;
    this.#client = new HostawayClient(credentials, {
      ...client,
      fetchImpl: async (input, init) => {
        const response = await network(input, init);
        const fence = this.#fence;
        return fence !== null && isConversationList(input) ? await fencedPage(response, fence) : response;
      },
    });
  }

  async #read<T>(what: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error: unknown) {
      throw toSignalSourceError(error, what);
    }
  }

  /**
   * Published guest reviews sent from the day of `since` up to `until`.
   * The list is asked oldest first; a review not yet published (Hostaway
   * keeps a row for every stay long before the guest writes) is dropped.
   */
  async fetchReviews({ since, until }: TimeWindow): Promise<FetchedReviews> {
    const startDay = utcDay(since);
    const items = await this.#read("Reading reviews", () =>
      this.#client.listAll(REVIEWS_ENDPOINT, this.#reviewsPageSize, {
        type: "guest-to-host",
        submittedAtStart: startDay,
        sortBy: "submittedAt",
        sortOrder: "asc",
      }));

    const floor = `${startDay}T00:00:00Z`;
    const ceiling = until.toISOString();
    const reviews: NeutralReview[] = [];
    let skipped = 0;

    for (const item of items) {
      if (!isRecord(item)) {
        skipped += 1;
        continue;
      }
      const sentAt = parseHostawayTime(item.submittedAt);
      if (item.type !== "guest-to-host" || (sentAt !== null && sentAt < floor)) {
        throw new SignalSourceError(
          "filter_ignored",
          "Hostaway answered outside the asked window or type",
        );
      }
      if (item.status !== "published" || sentAt === null || sentAt >= ceiling) {
        continue;
      }
      try {
        reviews.push(normalizeHostawayReview(item));
      } catch (error: unknown) {
        if (!(error instanceof SignalSourceError)) {
          throw error;
        }
        skipped += 1;
      }
    }

    return { reviews, skipped };
  }

  /**
   * A notification of a new message → which message and where, without its
   * text (the body is never read here). The webhook's Basic Auth is the
   * receiving function's to check, before this; Hostaway signs nothing.
   */
  parseWebhook({ body }: WebhookRequest): NeutralMessageEvent | null {
    if (!isRecord(body) || !isMessageNotification(body)) {
      return null;
    }
    const fields = messageFields(body.data, null);
    return {
      externalId: fields.externalId,
      externalConversationId: fields.externalConversationId,
      externalAccountId: idText(body.accountId),
      sentAt: fields.sentAt,
      direction: fields.direction,
      automated: fields.automated,
      channel: fields.channel,
      place: { externalListingId: fields.externalListingId, externalUnitId: null },
      externalReservationId: fields.externalReservationId,
    };
  }

  /**
   * Conversations whose guest wrote at or after `since`, newest first, read
   * through the fence: only their ids, listing, booking and the time of the
   * guest's latest message ever leave it.
   */
  async listActiveConversations(since: Date): Promise<readonly ActiveConversation[]> {
    if (this.#fence !== null) {
      throw new Error("One listing of conversations at a time");
    }
    this.#fence = new ConversationListFence(since);
    let listed: unknown[];
    try {
      listed = await this.#read("Listing conversations", () =>
        this.#client.listAll(CONVERSATIONS_ENDPOINT, this.#conversationsPageSize));
    } finally {
      this.#fence = null;
    }

    const seen = new Set<string>();
    const active: ActiveConversation[] = [];
    for (const item of listed) {
      const conversation = activeConversation(item as ListedConversation);
      // Offset pages shift while a guest writes: one conversation may come twice.
      if (conversation === null || seen.has(conversation.externalConversationId)) {
        continue;
      }
      seen.add(conversation.externalConversationId);
      active.push(conversation);
    }
    return active;
  }

  /** A conversation's messages sent at or after `since`, in Hostaway's order; each once. */
  async fetchConversation(externalConversationId: string, since: Date): Promise<readonly NeutralMessage[]> {
    if (!HOSTAWAY_ID.test(externalConversationId)) {
      throw new SignalSourceError("bad_row", "Not a Hostaway conversation id");
    }
    const items = await this.#read("Reading a conversation", () =>
      this.#client.listAll(
        `${CONVERSATIONS_ENDPOINT}/${externalConversationId}/messages`,
        this.#messagesPageSize,
      ));

    const floor = since.getTime();
    const seen = new Set<string>();
    const messages: NeutralMessage[] = [];
    for (const item of items) {
      const message = neutralMessage(item, externalConversationId);
      if (message.sentAt.getTime() < floor || seen.has(message.externalId)) {
        continue;
      }
      seen.add(message.externalId);
      messages.push(message);
    }
    return messages;
  }

  /**
   * A booking's guest names and room, also of a past booking we no longer
   * hold, in one request (`reservations/{id}?includeResources=1`):
   * - the names as the booking has them (`guestName`, `guestFirstName`,
   *   `guestLastName`), to strip from the texts — in memory, for the run;
   * - the room of a stay inside a listing: the one `reservationUnit[].
   *   listingUnitId` it names; a booking of several rooms names none.
   * A booking Hostaway no longer has (404) is gone, not failing — and so is
   * an id that cannot be one; any other failure is unavailable.
   */
  async namesOf(externalReservationId: string): Promise<NamesResult> {
    if (!HOSTAWAY_ID.test(externalReservationId)) {
      return { status: "gone" };
    }
    let booking: Raw;
    try {
      booking = await this.#client.getObject(`reservations/${externalReservationId}?includeResources=1`);
    } catch (error: unknown) {
      return isClientStatus(error, BOOKING_GONE) ? { status: "gone" } : { status: "unavailable" };
    }
    const units = Array.isArray(booking.reservationUnit) ? booking.reservationUnit : [];
    const ids = units
      .map((unit) => (isRecord(unit) ? idText(unit.listingUnitId) : null))
      .filter((unit): unit is string => unit !== null);
    const distinct = [...new Set(ids)];
    return {
      status: "ok",
      names: names(booking.guestName, booking.guestFirstName, booking.guestLastName),
      externalUnitId: distinct.length === 1 ? distinct[0] : null,
    };
  }
}
