/**
 * One tick of read-guest-messages (docs/guest-chats.md): every two minutes,
 * nothing at all while signal_settings.messages_enabled is off.
 *
 * 1. The webhook journal's new guest messages become conversations to read
 *    (collect_guest_message_events); once an hour the PMS's list of active
 *    conversations is the net under a missed webhook.
 * 2. Conversations quiet for five minutes (or waiting fifteen) are claimed, a
 *    few a tick. Each is read from the PMS in memory: only the guest's messages,
 *    never the host's or automatic ones, and of those only the ones inside the
 *    booking's stay, from the day of arrival to the day of departure.
 * 3. The new ones are redacted (redactMessage: the reviews' rules and codes) and
 *    sent with up to three earlier ones as context — one booked call, under the
 *    message row's calls and money of the day and the month.
 * 4. apply_guest_message_reading stores keys, labels and cards in one
 *    transaction and moves the conversation's line on. No text is stored, and
 *    none leaves this function but to the model.
 *
 * A failure is a code: the PMS's (source_*), the model's (model_* / service_*),
 * the ceiling's. A conversation that fails waits and is tried again, five
 * times at most; the service failing stops the model for the tick.
 */

import {
  type ActiveConversation,
  type GuestSignalAdapter,
  type NeutralMessage,
  SignalSourceError,
  sourceErrorCode,
} from "./adapter.ts";
import { ModelError, toModelError } from "./classify.ts";
import type { SignalKeyer } from "./key.ts";
import {
  fitMessages,
  MESSAGE_THEMES_DETECTOR,
  type MessageLabel,
  type MessageThemeClient,
  parseMessageThemes,
  redactMessage,
  type StayPhase,
} from "./message-read.ts";
import { hasUsableName, type RedactionNames } from "./redact.ts";
import { costMicroUsd, WORST_CALL_MICRO_USD } from "./themes-read.ts";
import { countErrors, type RunError } from "./types.ts";

/** Conversations one tick reads at most: a tick ends long before the next one starts. */
export const CLAIM_LIMIT = 6;
/** A tick stops taking conversations after this long; the rest wait for the next. */
export const TICK_BUDGET_MS = 90_000;
/** How far back the poll looks: the hour since the last poll, and some. */
export const POLL_LOOKBACK_MS = 2 * 60 * 60 * 1000;

export interface MessageState {
  readonly enabled: boolean;
  readonly daily_cap: number;
  readonly daily_budget: number;
  readonly month_budget: number;
  readonly min_confidence: number;
  readonly calls_today: number;
  readonly spent_today: number;
  readonly spent_month: number;
  readonly poll_due: boolean;
}

export interface ClaimedConversation {
  readonly external_conversation_id: string;
  readonly external_listing_id: string;
  readonly external_reservation_id: string | null;
  readonly read_to: string | null;
}

export interface ConversationStay {
  readonly property_id: number;
  readonly room_id: number | null;
  readonly reservation_id: number | null;
  readonly arrival_date: string | null;
  readonly departure_date: string | null;
  readonly cancelled: boolean;
}

export type Reservation =
  | { readonly granted: true; readonly runId: number }
  | { readonly granted: false; readonly reason: string };

export interface StoredMessage {
  readonly external_key: string;
  readonly external_id: string;
  readonly sent_at: string;
  readonly phase: StayPhase;
  readonly attachments: number;
}

export interface ApplyInput {
  readonly conversation: {
    readonly external_conversation_id: string;
    readonly conversation_key: string;
    readonly external_listing_id: string;
    readonly external_unit_id: string | null;
    readonly external_reservation_id: string | null;
    readonly channel: string;
  };
  readonly messages: readonly StoredMessage[];
  readonly labels: readonly MessageLabel[];
  readonly readTo: Date;
  readonly runId: number | null;
  readonly spentMicroUsd: number | null;
  readonly counts: Readonly<Record<string, number>>;
}

/** What a tick reads from the database and writes into it, for one PMS of one company. */
export interface MessageStore {
  state(): Promise<MessageState | null>;
  collect(): Promise<number>;
  queuePolled(rows: readonly ActiveConversation[]): Promise<{ readonly queued: number; readonly missed: number }>;
  claim(limit: number): Promise<readonly ClaimedConversation[]>;
  stay(listing: string, unit: string | null, reservation: string | null): Promise<ConversationStay | null>;
  reserve(worstMicroUsd: number): Promise<Reservation>;
  apply(input: ApplyInput): Promise<Readonly<Record<string, number>>>;
  failRun(
    runId: number,
    spentMicroUsd: number | null,
    counts: Readonly<Record<string, number>>,
    errors: readonly RunError[],
  ): Promise<void>;
  finish(conversationId: string, readTo: Date | null, error: string | null): Promise<void>;
  /** The company's people and places, for the redaction. */
  redactionNames(): Promise<Pick<RedactionNames, "staff" | "places">>;
  log(isOk: boolean, counts: Readonly<Record<string, number>>, errors: readonly RunError[]): Promise<void>;
}

export interface MessageRunDeps {
  readonly store: MessageStore;
  readonly adapter: GuestSignalAdapter;
  /** Null when the function has no key: conversations wait, nothing is read. */
  readonly model: MessageThemeClient | null;
  /** HMAC of a message's id ('<provider>:message:<id>'). */
  readonly keyOf: SignalKeyer;
  /** HMAC of a conversation's id ('<provider>:conversation:<id>'). */
  readonly conversationKeyOf: SignalKeyer;
  readonly now?: () => Date;
}

export interface MessageRunSummary {
  readonly status: "off" | "done";
  readonly collected: number;
  readonly polled: number;
  readonly missed: number;
  readonly claimed: number;
  readonly read: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly stopped: string | null;
  readonly errors: readonly RunError[];
}

const OFF: MessageRunSummary = {
  status: "off",
  collected: 0,
  polled: 0,
  missed: 0,
  claimed: 0,
  read: 0,
  counts: {},
  stopped: null,
  errors: [],
};

/** A date of the stay as a Prague day, compared as YYYY-MM-DD. */
export function pragueDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** When in the stay a message was sent, or null outside it (before arrival, after departure). */
export function phaseOf(sentAt: Date, arrival: string, departure: string): StayPhase | null {
  const day = pragueDay(sentAt);
  if (day < arrival || day > departure) {
    return null;
  }
  if (day === arrival) {
    return "arrival_day";
  }
  return day === departure ? "departure_day" : "stay";
}

/** The first moment the PMS is asked for: the day before arrival, UTC — a Prague day starts earlier. */
function stayStart(arrival: string): Date {
  return new Date(Date.parse(`${arrival}T00:00:00Z`) - 24 * 60 * 60 * 1000);
}

function add(into: Record<string, number>, counts: Readonly<Record<string, number>>): void {
  for (const [key, value] of Object.entries(counts)) {
    into[key] = (into[key] ?? 0) + value;
  }
}

function bump(into: Record<string, number>, key: string): void {
  into[key] = (into[key] ?? 0) + 1;
}

/** A failure as a code for the journal: the PMS's, the model's, or ours. Never its words. */
function failureCode(error: unknown): string {
  if (error instanceof SignalSourceError) {
    return sourceErrorCode(error);
  }
  return error instanceof ModelError ? error.code : "failed";
}

/** The reasons a reservation was refused that end the tick's reading. */
const CEILINGS = new Set(["daily_cap", "daily_budget", "month_budget", "off"]);

/** Room left for one more booked call: the tick does not claim what it could not read. */
function hasRoom(state: MessageState): boolean {
  return state.calls_today < state.daily_cap &&
    state.spent_today + WORST_CALL_MICRO_USD <= state.daily_budget &&
    state.spent_month + WORST_CALL_MICRO_USD <= state.month_budget;
}

interface ReadOutcome {
  /** The conversation is done with: read up to here. */
  readonly readTo: Date | null;
  /** Or failed with this code. */
  readonly error: string | null;
  /** The service failed: no more calls this tick. */
  readonly stopModel?: string;
  /** A ceiling was reached: no more conversations this tick. */
  readonly stopTick?: string;
}

export async function runMessages(deps: MessageRunDeps): Promise<MessageRunSummary> {
  const { store, adapter, model, keyOf, conversationKeyOf } = deps;
  const now = deps.now ?? (() => new Date());
  const startedAt = now().getTime();

  const state = await store.state();
  if (state === null || !state.enabled) {
    return OFF;
  }

  const counts: Record<string, number> = {};
  const codes: string[] = [];
  const collected = await store.collect();

  let polled = 0;
  let missed = 0;
  if (state.poll_due && adapter.listActiveConversations !== undefined) {
    try {
      const active = await adapter.listActiveConversations(new Date(now().getTime() - POLL_LOOKBACK_MS));
      const result = await store.queuePolled(active);
      polled = active.length;
      missed = result.missed;
      counts.webhook_missed = result.missed;
    } catch (error: unknown) {
      codes.push(`poll_${sourceErrorCode(error)}`);
    }
  }

  let claimed: readonly ClaimedConversation[] = [];
  let stopped: string | null = null;
  if (model === null) {
    stopped = "no_model";
  } else if (!hasRoom(state)) {
    stopped = "ceiling";
  } else {
    claimed = await store.claim(CLAIM_LIMIT);
  }

  let read = 0;
  let stopModel: string | null = null;
  if (claimed.length > 0 && model !== null) {
    const people = await store.redactionNames();
    for (const conversation of claimed) {
      if (stopped !== null || stopModel !== null || now().getTime() - startedAt > TICK_BUDGET_MS) {
        // Not read this tick: back to the queue, a try spent, a little wait.
        await store.finish(conversation.external_conversation_id, null, stopped ?? stopModel ?? "deferred");
        bump(counts, "deferred");
        continue;
      }
      let outcome: ReadOutcome;
      try {
        outcome = await readConversation(conversation, {
          store,
          adapter,
          model,
          keyOf,
          conversationKeyOf,
          people,
          counts,
        });
      } catch (error: unknown) {
        outcome = { readTo: null, error: failureCode(error) };
      }
      if (outcome.error !== null) {
        codes.push(outcome.error);
        await store.finish(conversation.external_conversation_id, null, outcome.error);
      } else {
        read += 1;
      }
      if (outcome.stopModel !== undefined) {
        stopModel = outcome.stopModel;
      }
      if (outcome.stopTick !== undefined) {
        stopped = outcome.stopTick;
      }
    }
  }

  const errors = countErrors(codes);
  const didSomething = collected > 0 || polled > 0 || claimed.length > 0 || codes.length > 0;
  // A tick with nothing to do writes nothing, but one an hour does: the panel's
  // line tells a quiet hour from a stopped job.
  if (didSomething || now().getUTCMinutes() < 2) {
    await store.log(codes.length === 0 && stopModel === null, {
      collected,
      polled,
      claimed: claimed.length,
      read,
      ...counts,
    }, errors);
  }

  return {
    status: "done",
    collected,
    polled,
    missed,
    claimed: claimed.length,
    read,
    counts,
    stopped: stopped ?? stopModel,
    errors,
  };
}

interface ReadContext {
  readonly store: MessageStore;
  readonly adapter: GuestSignalAdapter;
  readonly model: MessageThemeClient;
  readonly keyOf: SignalKeyer;
  readonly conversationKeyOf: SignalKeyer;
  readonly people: Pick<RedactionNames, "staff" | "places">;
  readonly counts: Record<string, number>;
}

/** The guest's own words: not the host's, not automatic. */
function isGuests(message: NeutralMessage): boolean {
  return message.direction === "guest" && !message.automated;
}

function hasWords(message: NeutralMessage): boolean {
  return message.text !== null && message.text.trim() !== "";
}

async function readConversation(conversation: ClaimedConversation, ctx: ReadContext): Promise<ReadOutcome> {
  const { store, adapter, counts } = ctx;
  const id = conversation.external_conversation_id;

  const stay = await store.stay(conversation.external_listing_id, null, conversation.external_reservation_id);
  if (
    stay === null || stay.reservation_id === null || stay.cancelled ||
    stay.arrival_date === null || stay.departure_date === null ||
    conversation.external_reservation_id === null
  ) {
    // Not a stay of ours we hold: nothing of it is read (the owner's decision 5).
    bump(counts, stay === null ? "not_ours" : "no_stay");
    await store.finish(id, null, null);
    return { readTo: null, error: null };
  }
  if (adapter.fetchConversation === undefined) {
    return { readTo: null, error: "source_no_conversations" };
  }

  const all = await adapter.fetchConversation(id, stayStart(stay.arrival_date));
  const guests = all.filter(isGuests).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const line = conversation.read_to === null ? null : Date.parse(conversation.read_to);
  const readTo = guests.length > 0
    ? new Date(Math.max(...guests.map((message) => message.sentAt.getTime()), line ?? 0))
    : (line === null ? null : new Date(line));

  const inStay = guests
    .map((message) => ({ message, phase: phaseOf(message.sentAt, stay.arrival_date!, stay.departure_date!) }))
    .filter((entry): entry is { message: NeutralMessage; phase: StayPhase } => entry.phase !== null);
  const fresh = inStay.filter(({ message }) => line === null || message.sentAt.getTime() > line);
  const earlier = inStay.filter(({ message }) => line !== null && message.sentAt.getTime() <= line);
  bump(counts, "conversations");
  add(counts, { outside_stay: guests.filter((m) => line === null || m.sentAt.getTime() > line).length - fresh.length });

  if (fresh.length === 0) {
    await store.finish(id, readTo, null);
    return { readTo, error: null };
  }

  const names = await adapter.namesOf(conversation.external_reservation_id);
  if (names.status === "unavailable") {
    // The booking's names could not be read now: no text may go out unredacted. Again later.
    return { readTo: null, error: "source_names_unavailable" };
  }
  const guestNames = names.status === "ok" ? names.names : [];
  const unit = names.status === "ok" ? names.externalUnitId : null;

  const stored: StoredMessage[] = await Promise.all(fresh.map(async ({ message, phase }) => ({
    external_key: await ctx.keyOf(message.externalId),
    external_id: message.externalId,
    sent_at: message.sentAt.toISOString(),
    phase,
    attachments: message.attachments,
  })));
  const newest = fresh[fresh.length - 1];
  const base = {
    conversation: {
      external_conversation_id: id,
      conversation_key: await ctx.conversationKeyOf(id),
      external_listing_id: newest.message.place.externalListingId,
      external_unit_id: unit,
      external_reservation_id: conversation.external_reservation_id,
      channel: newest.message.channel,
    },
    messages: stored,
    readTo: readTo ?? newest.message.sentAt,
  };

  const worded = fresh.filter(({ message }) => hasWords(message));
  if (worded.length === 0 || !hasUsableName(guestNames)) {
    // Keys only: an attachment alone has nothing to read, and a text whose
    // guest has no name to take out does not go to the model.
    bump(counts, worded.length === 0 ? "no_words" : "no_names");
    add(counts, await store.apply({ ...base, labels: [], runId: null, spentMicroUsd: null, counts: {} }));
    return { readTo: base.readTo, error: null };
  }

  const booking = await store.reserve(WORST_CALL_MICRO_USD);
  if (!booking.granted) {
    bump(counts, `stopped_${booking.reason}`);
    return {
      readTo: null,
      error: booking.reason,
      stopTick: CEILINGS.has(booking.reason) ? booking.reason : undefined,
    };
  }

  const redaction: RedactionNames = { guest: guestNames, staff: ctx.people.staff, places: ctx.people.places };
  const texts = fitMessages(
    worded.map(({ message }) => redactMessage(message.text!, redaction)),
    earlier.filter(({ message }) => hasWords(message)).map(({ message }) => redactMessage(message.text!, redaction)),
  );

  let labels: readonly MessageLabel[];
  let spent: number;
  let invalid: number;
  try {
    const reading = await ctx.model.read({
      channel: newest.message.channel,
      phase: newest.phase,
      earlier: texts.earlier,
      fresh: texts.fresh,
    });
    spent = costMicroUsd(reading);
    const answer = parseMessageThemes(reading.raw);
    labels = answer.labels;
    invalid = answer.invalid;
  } catch (error: unknown) {
    const failure = error instanceof ModelError ? error : toModelError(error);
    await store.failRun(booking.runId, null, { model_failed: 1 }, [{ code: failure.code, count: 1 }]);
    return {
      readTo: null,
      error: failure.code,
      stopModel: failure.scope === "service" ? failure.code : undefined,
    };
  }

  bump(counts, "model_read");
  add(counts, await store.apply({
    ...base,
    labels,
    runId: booking.runId,
    spentMicroUsd: spent,
    counts: { model_read: 1, invalid },
  }));
  return { readTo: base.readTo, error: null };
}
