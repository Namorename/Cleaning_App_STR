/**
 * A guest review's own words, read from the PMS on the fly for the panel's
 * «Все отзывы» (docs/guest-review-text.md). The manager sees the original,
 * as in Hostaway; nothing of it is written: the text passes through this
 * function's memory into the answer — the month's page stays there at most
 * ten minutes (cache.ts) — and goes nowhere else: not into the database, not
 * into a log, not into an error.
 *
 * - Who: an active manager or admin of the company, by the session token,
 *   with the role and the company read from the database (profiles), not
 *   from the token.
 * - What: a review of the company, by OUR id (guest_signals.id). The PMS's
 *   review id is not kept once the stay is cut (the owner's decision of
 *   2026-10-18), so the review is found again by its key: the reviews the PMS
 *   sent in the stored month (or day, while the stay is exact) are keyed one
 *   by one with GUEST_SIGNAL_KEY_SECRET until one matches the stored HMAC.
 * - How often: 120 reads a person in ten minutes (take_review_text_read),
 *   counted before anything is looked up. The month's page of the PMS is
 *   kept by the instance for ten minutes (cache.ts), so reading through a
 *   month asks Hostaway once.
 * - From where: the panel's own pages. A request from any other page (its
 *   Origin) is refused, and no CORS header lets that page read an answer; a
 *   request without an Origin is no page's and goes on to the token.
 * - What goes back: the public review, the private feedback and the comments
 *   by category. Never the guest's name, the booking, the listing's name or
 *   any id of the PMS. `Cache-Control: no-store`.
 *
 * Refusals use the panel's shape, `{error: {message, hint, details}}`, so
 * functionError() and serverErrorText() translate them like any other.
 */

import { normalizeHostawayReview } from "../_shared/signals/hostaway.ts";
import { pageKey } from "./cache.ts";

/**
 * The panel's pages: the production address, the project's Vercel
 * deployments (their nine-letter hash), a panel on this machine (the local
 * stands use several ports). A custom domain needs its line here.
 */
const PANEL_ORIGINS: readonly RegExp[] = [
  /^https:\/\/woom-bnb\.vercel\.app$/,
  /^https:\/\/woom-[a-z0-9]{9}-namorename\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/,
];

export function isPanelOrigin(origin: string): boolean {
  return PANEL_ORIGINS.some((pattern) => pattern.test(origin));
}

/** CORS for one of the panel's pages: its own origin, never "*". */
function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

/** The panel's roles: the office reads the reviews (row level security says the same). */
export const READER_ROLES: readonly string[] = ["manager", "admin"];
/** The panel sends `{"signal_id": "<uuid>"}`; anything this large is not the panel. */
const MAX_BODY_BYTES = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The provider whose reviews this function can read again. */
export const READABLE_PROVIDER = "hostaway";
/** The ten minutes the reads are counted in (take_review_text_read). */
const READ_WINDOW_S = 600;
/**
 * Reads a person may make in those ten minutes: take_review_text_read's own
 * c_limit (20261104200000), told to the panel with the refusal; a test holds
 * the two equal.
 */
export const READS_PER_WINDOW = 120;
const DAY_MS = 86_400_000;
/** The company's day and month, as the database cuts a stay (signal_month_of). */
const COMPANY_TIME_ZONE = "Europe/Prague";

export interface Caller {
  readonly id: string;
  readonly role: string;
  readonly hostId: string;
  readonly isActive: boolean;
}

/** What the database keeps of a review that is needed to find it again. */
export interface StoredReview {
  readonly provider: string;
  /** HMAC of "<provider>:review:<the PMS's id>", or "purged:<id>" once its 18 months are over. */
  readonly externalKey: string;
  /** Exact while the stay is; the first moment of its Prague month once cut. */
  readonly submittedAt: string;
  readonly stayExact: boolean;
}

/** The days to ask the PMS for, both inclusive, as `YYYY-MM-DD`. */
export interface SearchWindow {
  readonly start: string;
  readonly end: string;
}

export interface ReviewText {
  readonly public_text: string | null;
  readonly private_text: string | null;
  readonly category_comments: Readonly<Record<string, string>>;
}

export interface ReviewTextDeps {
  /** The person behind a session token, from Auth and profiles; null when the token is nobody's. */
  readonly identify: (token: string) => Promise<Caller | null>;
  /** Counts one read; false past the limit. Throws when the counter cannot be reached. */
  readonly takeRead: (userId: string) => Promise<boolean>;
  /** A review of this company by our id; null when there is none. */
  readonly findReview: (hostId: string, signalId: string) => Promise<StoredReview | null>;
  /** The PMS's guest reviews sent within the window, as the PMS sends them. */
  readonly listReviews: (window: SearchWindow) => Promise<readonly unknown[]>;
  /** The key of a PMS review id, as sync-guest-signals makes it. */
  readonly keyOf: (externalId: string) => Promise<string>;
  /** The instance's pages of the PMS by company and window (cache.ts); none, and every read asks. */
  readonly pages?: {
    get(key: string, now: number): readonly unknown[] | undefined;
    set(key: string, items: readonly unknown[], now: number): void;
  };
  readonly now?: () => number;
  /** One line per request: the outcome's code and the time — never a text, a name or an id. */
  readonly log?: (line: string) => void;
}

/** An answer without CORS: the handler adds it for the panel's pages only. */
function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
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

/**
 * The body, read no further than the cap (as mcp reads its own): a chunked
 * upload without a length is never buffered whole.
 */
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

/** The body's review id, or null when the body is not the panel's. */
async function readSignalId(request: Request): Promise<string | null> {
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
  const id = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).signal_id
    : null;
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `YYYY-MM` of an instant in the company's time zone. */
function companyMonth(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: COMPANY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
}

/**
 * Where to look for a review in the PMS: its day while the stay is exact, its
 * month once cut, with a day on either side — the PMS and the company may
 * not agree on the hour a review came in, and its ends are whole days.
 */
export function searchWindow(review: Pick<StoredReview, "submittedAt" | "stayExact">): SearchWindow {
  if (review.stayExact) {
    const at = Date.parse(review.submittedAt);
    return { start: utcDay(at - DAY_MS), end: utcDay(at + DAY_MS) };
  }
  const [year, month] = companyMonth(review.submittedAt).split("-").map(Number);
  const first = Date.UTC(year, month - 1, 1);
  const nextFirst = Date.UTC(year, month, 1);
  return { start: utcDay(first - DAY_MS), end: utcDay(nextFirst) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The PMS's id of a review as the keyer takes it ("90000001"), or null. */
function idOf(item: Record<string, unknown>): string | null {
  const raw = item.id;
  const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? String(n) : null;
}

/** The texts of the one review whose key is the stored one, or null when the PMS has none such. */
export async function findTexts(
  items: readonly unknown[],
  externalKey: string,
  keyOf: (externalId: string) => Promise<string>,
): Promise<ReviewText | null> {
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const id = idOf(item);
    if (id === null || (await keyOf(id)) !== externalKey) {
      continue;
    }
    // The same reading of a review as the load's: the same fields, the same
    // categories. Its names and ids are dropped here.
    const { texts } = normalizeHostawayReview(item);
    return {
      public_text: texts.publicText,
      private_text: texts.privateText,
      category_comments: texts.categoryComments,
    };
  }
  return null;
}

async function answer(request: Request, deps: ReviewTextDeps): Promise<Outcome> {
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
    return refusal("not_office", 403, "Only the office reads guest reviews", "serverErrors.managerOnly");
  }
  const signalId = await readSignalId(request);
  if (signalId === null) {
    return refusal("bad_body", 400, "The body names no review", "serverErrors.unknown");
  }

  let allowed: boolean;
  try {
    allowed = await deps.takeRead(caller.id);
  } catch {
    // The counter is the fence: without it, nothing is read.
    return refusal("limit_unavailable", 503, "The read could not be counted", "serverErrors.reviewTextUnavailable");
  }
  if (!allowed) {
    const left = READ_WINDOW_S - (Math.floor(now() / 1000) % READ_WINDOW_S);
    return refusal(
      "limited",
      429,
      "Too many review texts read in ten minutes",
      "serverErrors.reviewTextLimit",
      { "Retry-After": String(left) },
      { limit: READS_PER_WINDOW, minutes: READ_WINDOW_S / 60 },
    );
  }

  const review = await deps.findReview(caller.hostId, signalId);
  if (review === null || review.provider !== READABLE_PROVIDER) {
    return refusal("not_found", 404, "No such review of the company", "serverErrors.reviewTextNotFound");
  }
  if (review.externalKey.startsWith("purged:")) {
    return refusal("purged", 410, "The review's time is over", "serverErrors.reviewTextGone");
  }

  const window = searchWindow(review);
  const key = pageKey(caller.hostId, window);
  const kept = deps.pages?.get(key, now());
  let texts = kept === undefined ? null : await findTexts(kept, review.externalKey, deps.keyOf);
  const isFromKept = texts !== null;
  // Not in the page kept from earlier (or none kept): the PMS is asked, and a
  // whole answer is kept for the next read of the month. A review that came
  // in after the page was kept is found this way too.
  if (texts === null) {
    let items: readonly unknown[];
    try {
      items = await deps.listReviews(window);
    } catch {
      // Only the code: the PMS's error may quote its answer. Nothing is kept.
      return refusal("source_unavailable", 502, "The PMS did not answer", "serverErrors.reviewTextUnavailable");
    }
    try {
      deps.pages?.set(key, items, now());
    } catch {
      // The page is kept for the next read only: failing to keep it never fails this one.
    }
    texts = await findTexts(items, review.externalKey, deps.keyOf);
  }
  if (texts === null) {
    return refusal("not_in_pms", 404, "The PMS no longer has the review", "serverErrors.reviewTextNotFound");
  }
  return { code: isFromKept ? "ok_kept" : "ok", response: json({ data: texts }, 200) };
}

/** The function itself: one answer per request, one line of log per answer. */
export function createReviewTextHandler(deps: ReviewTextDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.info(line));
  return async (request: Request) => {
    const started = now();
    const origin = request.headers.get("Origin");
    if (origin !== null && !isPanelOrigin(origin)) {
      // Another page: refused before anything is read, with no CORS header,
      // so even the refusal stays unreadable to it.
      const outcome = refusal("foreign_origin", 403, "Only the panel's pages may ask", "serverErrors.unknown");
      log(`guest-review-text ${outcome.code} in ${now() - started} ms`);
      return outcome.response;
    }
    const cors = origin === null ? {} : corsHeaders(origin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    let outcome: Outcome;
    try {
      outcome = await answer(request, deps);
    } catch (error: unknown) {
      // The name of the failure only: a message may carry what was being read.
      const kind = error instanceof Error ? error.name : "unknown";
      outcome = refusal(`failed:${kind}`, 500, "The review text could not be read", "serverErrors.unknown");
    }
    log(`guest-review-text ${outcome.code} in ${now() - started} ms`);
    for (const [name, value] of Object.entries(cors)) {
      outcome.response.headers.set(name, value);
    }
    return outcome.response;
  };
}
