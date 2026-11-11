/**
 * The guest's message a chat task was made of, read from the PMS on the fly for the task's page in the
 * panel, the card of «Гости» and the head technician's phone (docs/guest-message-text.md). Nothing of
 * it is written: the text passes through this function's memory into the answer — the answer stays
 * there three minutes at most (cache.ts) — and goes nowhere else: not into the database, not into a
 * log, not into an error.
 *
 * - Who: an active manager, admin or head technician of the company, by the session token, with the
 *   role and the company read from the database (profiles), not from the token. By a task, the
 *   office and the head technician; by a card of «Гости», the office alone (guest_message_target
 *   decides, after this function's own first look). A technician and a maid never.
 * - What: the message the card was raised on — found in the conversation by its id in the PMS, or by
 *   its key (HMAC under GUEST_SIGNAL_KEY_SECRET) once the id is gone — and at most two other messages
 *   of the guest within two hours of it, for the context. Only the guest's: the company's replies
 *   never leave this function.
 * - How long: as long as the conversation's number and the message's id or key are kept
 *   (20261111140000: a task's link lives until the guest's name goes, 91 days after the departure).
 *   After that the answer is «expired».
 * - How often: 60 reads a person in ten minutes (take_message_text_read), counted before anything is
 *   looked up.
 * - From where: the panel's own pages (_shared/panel-origin.ts) or no page at all — the phone sends
 *   no Origin. Any other page is refused and gets no CORS header.
 * - What goes back: the messages' words as Hostaway has them, their times and how many files came
 *   with each. Never the guest's name, the booking, the listing or any id of the PMS.
 *   `Cache-Control: no-store`.
 *
 * Refusals use the panel's shape, `{error: {message, hint, details}}`, so functionError() and
 * serverErrorText() translate them like any other.
 */

import { isPanelOrigin, panelCorsHeaders } from "../_shared/panel-origin.ts";
import { idText, parseHostawayTime } from "../_shared/signals/hostaway.ts";
import { answerKey } from "./cache.ts";
import { ConversationGoneError } from "./pms.ts";

/** The roles that may read a guest's message at all; the database decides the rest. */
export const READER_ROLES: readonly string[] = ["manager", "admin", "head_tech"];
/** The panel and the phone send `{"problem_id": "<uuid>"}` or `{"finding_id": "<uuid>"}`. */
const MAX_BODY_BYTES = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The provider whose conversations this function can read. */
export const READABLE_PROVIDER = "hostaway";
/** The ten minutes the reads are counted in (take_message_text_read). */
const READ_WINDOW_S = 600;
/**
 * Reads a person may make in those ten minutes: take_message_text_read's own c_limit
 * (20261111140000), told to the screen with the refusal; a test holds the two equal.
 */
export const READS_PER_WINDOW = 60;
/** The guest's other messages shown around the one asked for: within two hours of it. */
export const CONTEXT_WINDOW_MS = 2 * 60 * 60 * 1000;
/** At most three messages in an answer: the one asked for and two around it. */
export const MAX_MESSAGES = 3;
/** A message longer than this is cut, so an answer stays a few pages of text at most. */
export const MAX_TEXT_CHARS = 4000;

export interface Caller {
  readonly id: string;
  readonly role: string;
  readonly hostId: string;
  readonly isActive: boolean;
}

/** What the screen asks about: a task, or a card of «Гости». */
export type Ask = { readonly problemId: string } | { readonly findingId: string };

/** guest_message_target's answer (20261111140000). */
export type Target =
  | {
    readonly status: "ok";
    readonly provider: string;
    readonly conversationId: string;
    readonly messageId: string | null;
    readonly messageKey: string | null;
  }
  | { readonly status: "forbidden" | "not_found" | "expired" };

/** guest_message_target's JSON, read field by field; anything it does not recognise is «not found». */
export function readTarget(value: unknown): Target {
  const row = isRecord(value) ? value : {};
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  if (row.status === "forbidden" || row.status === "expired") {
    return { status: row.status };
  }
  const conversationId = text(row.conversation_id);
  if (row.status !== "ok" || conversationId === null) {
    return { status: "not_found" };
  }
  return {
    status: "ok",
    provider: text(row.provider) ?? "",
    conversationId,
    messageId: text(row.message_id),
    messageKey: text(row.message_key),
  };
}

/** One message of the answer. */
export interface GuestMessage {
  /** When it was sent, UTC, as Hostaway timed it. */
  readonly sent_at: string;
  /** The guest's words; null for a message of files alone. */
  readonly text: string | null;
  /** How many files came with it — a count, never the files. */
  readonly attachments: number;
  /** The message the card was raised on; the others are its context. */
  readonly is_flagged: boolean;
}

export interface MessageTextDeps {
  /** The person behind a session token, from Auth and profiles; null when the token is nobody's. */
  readonly identify: (token: string) => Promise<Caller | null>;
  /** Counts one read; false past the limit. Throws when the counter cannot be reached. */
  readonly takeRead: (userId: string) => Promise<boolean>;
  /** What this person may read for the ask (guest_message_target). */
  readonly findTarget: (userId: string, ask: Ask) => Promise<Target>;
  /** The conversation's messages, as the PMS sends them; ConversationGoneError when it has none. */
  readonly listMessages: (conversationId: string) => Promise<readonly unknown[]>;
  /** The key of a PMS message id, as read-guest-messages makes it. */
  readonly keyOf: (externalId: string) => Promise<string>;
  /** The instance's last answers (cache.ts); none, and every read asks. */
  readonly answers?: {
    get(key: string, now: number): readonly GuestMessage[] | undefined;
    set(key: string, messages: readonly GuestMessage[], now: number): void;
  };
  readonly now?: () => number;
  /** One line per request: the outcome's code and the time — never a text, a name or an id. */
  readonly log?: (line: string) => void;
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

/** A refusal and the one word the log keeps of it. */
interface Outcome {
  readonly code: string;
  readonly response: Response;
}

function refusal(
  code: string,
  status: number,
  message: string,
  hint: string,
  extra: Record<string, string> = {},
  details: Readonly<Record<string, number>> | null = null,
): Outcome {
  const body = { error: { message, hint, details: details === null ? null : JSON.stringify(details) } };
  return { code, response: json(body, status, extra) };
}

function readBearer(request: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("Authorization") ?? "");
  return match === null ? null : match[1];
}

/** The body, read no further than the cap: a chunked upload without a length is never buffered whole. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return null;
  }
  if (request.body === null) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuidOf(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

/** The body's task or card, exactly one of them; null when the body is not the screens'. */
async function readAsk(request: Request): Promise<Ask | null> {
  const text = await readBody(request);
  if (text === null) {
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(body)) {
    return null;
  }
  const problemId = uuidOf(body.problem_id);
  const findingId = uuidOf(body.finding_id);
  if (problemId !== null && findingId === null) {
    return { problemId };
  }
  if (findingId !== null && problemId === null) {
    return { findingId };
  }
  return null;
}

/** A message of the PMS as this function reads it: who wrote it, when, its words and files. */
interface PmsMessage {
  readonly id: string;
  readonly at: number;
  readonly isGuest: boolean;
  readonly text: string | null;
  readonly attachments: number;
}

function wordsOf(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const words = value.trim();
  return words.length > MAX_TEXT_CHARS ? `${words.slice(0, MAX_TEXT_CHARS)}…` : words;
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * One message, read field by field: a row without an id or a time, or of another conversation, is
 * passed over — one odd row costs itself, not the answer. `insertedOn` first: it is UTC
 * (_shared/signals/hostaway.ts reads it the same way).
 */
function readMessage(raw: unknown, conversationId: string): PmsMessage | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = idText(raw.id);
  const sentAt = parseHostawayTime(raw.insertedOn) ?? parseHostawayTime(raw.date);
  const ofConversation = raw.conversationId === undefined || idText(raw.conversationId) === conversationId;
  if (id === null || sentAt === null || !ofConversation) {
    return null;
  }
  const incoming = raw.isIncoming;
  return {
    id,
    at: Date.parse(sentAt),
    isGuest: incoming === 1 || incoming === true || incoming === "1",
    text: wordsOf(raw.body),
    attachments: countOf(raw.attachments) + countOf(raw.imagesUrls),
  };
}

/**
 * The message asked for and at most two other messages of the guest within two hours of it, nearest
 * first, in the order they were sent; null when the guest's messages hold none such.
 */
export async function messagesAround(
  items: readonly unknown[],
  target: Extract<Target, { status: "ok" }>,
  keyOf: (externalId: string) => Promise<string>,
): Promise<GuestMessage[] | null> {
  const seen = new Set<string>();
  const guest: PmsMessage[] = [];
  for (const item of items) {
    const message = readMessage(item, target.conversationId);
    if (message !== null && message.isGuest && !seen.has(message.id)) {
      seen.add(message.id);
      guest.push(message);
    }
  }

  let flagged = target.messageId === null ? undefined : guest.find((m) => m.id === target.messageId);
  if (flagged === undefined && target.messageKey !== null) {
    for (const message of guest) {
      if ((await keyOf(message.id)) === target.messageKey) {
        flagged = message;
        break;
      }
    }
  }
  if (flagged === undefined) {
    return null;
  }

  const anchor = flagged;
  const context = guest
    .filter((m) => m !== anchor && Math.abs(m.at - anchor.at) <= CONTEXT_WINDOW_MS)
    .sort((a, b) => Math.abs(a.at - anchor.at) - Math.abs(b.at - anchor.at))
    .slice(0, MAX_MESSAGES - 1);
  return [anchor, ...context]
    .sort((a, b) => a.at - b.at)
    .map((m) => ({
      sent_at: new Date(m.at).toISOString(),
      text: m.text,
      attachments: m.attachments,
      is_flagged: m === anchor,
    }));
}

async function answer(request: Request, deps: MessageTextDeps): Promise<Outcome> {
  const now = deps.now ?? Date.now;
  if (request.method !== "POST") {
    return refusal("method", 405, "Only POST is served", "serverErrors.unknown", { Allow: "POST" });
  }
  const token = readBearer(request);
  if (token === null) {
    return refusal("no_token", 401, "No bearer token", "serverErrors.notSignedIn");
  }
  const caller = await deps.identify(token);
  if (caller === null) {
    return refusal("unknown_token", 401, "The token belongs to nobody", "serverErrors.notSignedIn");
  }
  if (!caller.isActive || !READER_ROLES.includes(caller.role)) {
    return refusal(
      "not_reader",
      403,
      "Only the office and the head technician read guests' messages",
      "serverErrors.guestMessageForbidden",
    );
  }
  const ask = await readAsk(request);
  if (ask === null) {
    return refusal("bad_body", 400, "The body names no task or card", "serverErrors.unknown");
  }

  let allowed: boolean;
  try {
    allowed = await deps.takeRead(caller.id);
  } catch {
    // The counter is the fence: without it, nothing is read.
    return refusal("limit_unavailable", 503, "The read could not be counted", "serverErrors.guestMessageUnavailable");
  }
  if (!allowed) {
    const left = READ_WINDOW_S - (Math.floor(now() / 1000) % READ_WINDOW_S);
    return refusal(
      "limited",
      429,
      "Too many guests' messages read in ten minutes",
      "serverErrors.guestMessageLimit",
      { "Retry-After": String(left) },
      { limit: READS_PER_WINDOW, minutes: READ_WINDOW_S / 60 },
    );
  }

  const target = await deps.findTarget(caller.id, ask);
  if (target.status === "forbidden") {
    return refusal(
      "forbidden",
      403,
      "Only the office and the head technician read guests' messages",
      "serverErrors.guestMessageForbidden",
    );
  }
  if (target.status === "expired") {
    return refusal("expired", 410, "The message's time is over", "serverErrors.guestMessageGone");
  }
  if (target.status !== "ok" || target.provider !== READABLE_PROVIDER) {
    return refusal("not_found", 404, "No such chat task or card of the company", "serverErrors.guestMessageNotFound");
  }

  const key = answerKey(caller.hostId, target.conversationId, target.messageId ?? target.messageKey ?? "");
  const kept = deps.answers?.get(key, now());
  if (kept !== undefined) {
    return { code: "ok_kept", response: json({ data: { messages: kept } }, 200) };
  }

  let items: readonly unknown[];
  try {
    items = await deps.listMessages(target.conversationId);
  } catch (error: unknown) {
    if (error instanceof ConversationGoneError) {
      return refusal("not_in_pms", 404, "The PMS has no such conversation", "serverErrors.guestMessageNotFound");
    }
    // Only the code: the PMS's error may quote its answer. Nothing is kept.
    return refusal("source_unavailable", 502, "The PMS did not answer", "serverErrors.guestMessageUnavailable");
  }
  const messages = await messagesAround(items, target, deps.keyOf);
  if (messages === null) {
    return refusal("not_in_pms", 404, "The PMS no longer has the message", "serverErrors.guestMessageNotFound");
  }
  try {
    deps.answers?.set(key, messages, now());
  } catch {
    // Kept for the next read only: failing to keep it never fails this one.
  }
  return { code: "ok", response: json({ data: { messages } }, 200) };
}

/** The function itself: one answer per request, one line of log per answer. */
export function createMessageTextHandler(deps: MessageTextDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.info(line));
  return async (request: Request) => {
    const started = now();
    const origin = request.headers.get("Origin");
    if (origin !== null && !isPanelOrigin(origin)) {
      // Another page: refused before anything is read, with no CORS header, so even the refusal
      // stays unreadable to it.
      const outcome = refusal("foreign_origin", 403, "Only the panel's pages may ask", "serverErrors.unknown");
      log(`guest-message-text ${outcome.code} in ${now() - started} ms`);
      return outcome.response;
    }
    const cors = origin === null ? {} : panelCorsHeaders(origin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    let outcome: Outcome;
    try {
      outcome = await answer(request, deps);
    } catch (error: unknown) {
      // The name of the failure only: a message may carry what was being read.
      const kind = error instanceof Error ? error.name : "unknown";
      outcome = refusal(`failed:${kind}`, 500, "The guest's message could not be read", "serverErrors.unknown");
    }
    log(`guest-message-text ${outcome.code} in ${now() - started} ms`);
    for (const [name, value] of Object.entries(cors)) {
      outcome.response.headers.set(name, value);
    }
    return outcome.response;
  };
}
