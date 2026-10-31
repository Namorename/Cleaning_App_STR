/**
 * One run of sync-guest-signals for reviews (docs/reviews-to-tasks.md §5,
 * docs/guest-signals.md §2.2): a PMS's published reviews since the
 * watermark, through its adapter, into ingest_guest_reviews() in portions.
 * The core knows no PMS: the adapter hands the PMS's ids as strings, the
 * database finds our place and booking. The database decides what is kept —
 * texts only for stays after the guest notice, never for hidden reviews or
 * places in the archive, the stay cut to its month once nothing waits on it;
 * this run only sends.
 *
 * - From the watermark minus three days (a review can appear a little after
 *   the time it says it was sent), the history of twelve months on the first
 *   run; on Sundays the last hundred days again, to see hidings and replies.
 * - Every review is keyed first (key.ts): the database meets it by the HMAC
 *   of "<provider>:review:<the PMS's id>", which outlives the id itself (the
 *   owner's decision of 2026-10-18).
 * - The database says what it already holds of the reviews read
 *   (review_load_state), so a text is redacted and sent, and a booking asked
 *   of the PMS, only for what is still missing.
 * - Texts are redacted here, in memory, before they leave the function: the
 *   guest's names from the review and from its booking (namesOf, the owner's
 *   decision of 2026-10-18), the company's people and places. The names are
 *   never written anywhere, logged, sent to the database or to the model.
 * - A text never goes before its booking is read. When the booking cannot be
 *   read — the PMS is unavailable, or the run's ceiling of booking reads is
 *   spent — the review waits whole: nothing of it is sent, and the run writes
 *   no watermark, so the next run reads the same window and asks again.
 *   Behind the ceiling it waits as long as it takes: the booking is there,
 *   the run only ran out of reads. Behind a failure it waits NAME_HOLD_DAYS
 *   from when it was sent; then it goes with the names it carries itself,
 *   and with no usable name known at all, without its text. Never with a name
 *   left in. A booking the PMS no longer has (`gone`) is not failing: the
 *   review goes with its own names at once.
 * - A room is asked only for a review of a building (a listing with rooms,
 *   signal_buildings) whose text may be kept: only those can become work.
 * - Only the last portion moves the watermark: a run cut short reads the
 *   same window again, and the upsert makes that harmless.
 */

import {
  type FetchedReviews,
  type GuestSignalAdapter,
  type NamesResult,
  type NeutralReview,
  type NeutralReviewRow,
  sourceErrorCode,
} from "./adapter.ts";
import type { SignalKeyer } from "./key.ts";
import { hasUsableName, redactText, type RedactionNames } from "./redact.ts";
import { countErrors, type ReviewTexts, type RunError, type SignalSettings } from "./types.ts";

export const SYNC_OVERLAP_DAYS = 3;
export const HISTORY_DAYS = 365;
export const SUNDAY_REREAD_DAYS = 100;
export const PORTION_SIZE = 500;
/** A bound on the PMS calls for bookings in one run; ≈ 10–15 a day are expected (docs §5). */
export const MAX_BOOKING_LOOKUPS = 30;
/** Failed booking reads in a row after which the run stops asking: the PMS is down, not the booking. */
export const BOOKING_FAILURES_TO_STOP = 2;
/** How long a review may wait behind a failing booking before it goes with the names it carries. */
export const NAME_HOLD_DAYS = 7;
/**
 * Characters of one text redacted at most. Longer than any column keeps
 * (8 000), so the database still sees a text was cut and says so, and short
 * enough that the contact patterns stay quick.
 */
export const MAX_REDACTED_CHARS = 16_000;

const DAY_MS = 86_400_000;

/** One row for ingest_guest_reviews(): the adapter's row, its key and, when they go, its redacted texts. */
export interface ReviewIngestRow extends NeutralReviewRow {
  /** HMAC of "<provider>:review:<the PMS's id>" (key.ts): what a repeated load meets the review by. */
  readonly external_key: string;
  /** Only when texts are kept, and always redacted. */
  readonly public_text?: string | null;
  readonly private_text?: string | null;
  readonly category_comments?: Readonly<Record<string, string>> | null;
}

export interface IngestResult {
  readonly inserted: number;
  readonly updated: number;
  readonly cut: number;
  readonly journal_written: boolean;
}

/** What the database already holds of a review it knows (review_load_state). */
export interface StoredReview {
  readonly publicKept: boolean;
  readonly privateKept: boolean;
  readonly commentsKept: boolean;
  /** The switches, the notice, a hiding, the archive and the 18 months still allow a text. */
  readonly textAllowed: boolean;
  readonly stayExact: boolean;
  readonly roomKnown: boolean;
}

/** The run's own numbers for the journal, beside the database's. */
export interface RunCounts {
  readonly fetched: number;
  readonly with_texts: number;
  readonly booking_lookups: number;
  readonly held_for_names: number;
  readonly texts_without_names: number;
}

/** What a run reads from the database and writes into it, for one PMS. */
export interface ReviewSyncStore {
  settings(): Promise<SignalSettings | null>;
  watermark(): Promise<Date | null>;
  /** The PMS's ids of our listings that have rooms under them (signal_buildings). */
  buildings(): Promise<ReadonlySet<string>>;
  /** The company's people and places, to strip from the texts. */
  redactionNames(): Promise<Pick<RedactionNames, "staff" | "places">>;
  /** The reviews the database already holds among these keys. */
  loadState(keys: readonly string[]): Promise<ReadonlyMap<string, StoredReview>>;
  ingest(
    rows: readonly ReviewIngestRow[],
    watermark: Date | null,
    errors: readonly RunError[],
    counts: RunCounts | null,
  ): Promise<IngestResult>;
}

export interface ReviewSyncDeps {
  readonly store: ReviewSyncStore;
  readonly adapter: GuestSignalAdapter;
  /** Keys of "<the adapter's provider>:review:<id>". */
  readonly keyOf: SignalKeyer;
  readonly now?: () => Date;
  readonly maxBookingLookups?: number;
}

export interface SyncSummary {
  /** "unsupported": the adapter's PMS has no reviews to read. */
  readonly status: "off" | "unsupported" | "done" | "failed";
  readonly since: string | null;
  readonly fetched: number;
  readonly skipped: number;
  readonly withTexts: number;
  readonly bookingLookups: number;
  readonly heldForNames: number;
  readonly textsWithoutNames: number;
  /** The run wrote no watermark: the next one reads the same window again. */
  readonly readAgain: boolean;
  readonly inserted: number;
  readonly updated: number;
  readonly cut: number;
  readonly journalWritten: boolean;
  readonly errors: readonly RunError[];
}

/** Where a run starts reading. */
export function syncWindowStart(watermark: Date | null, now: Date): Date {
  const start = watermark === null
    ? new Date(now.getTime() - HISTORY_DAYS * DAY_MS)
    : new Date(watermark.getTime() - SYNC_OVERLAP_DAYS * DAY_MS);
  if (now.getUTCDay() !== 0) {
    return start;
  }
  const reread = new Date(now.getTime() - SUNDAY_REREAD_DAYS * DAY_MS);
  return reread < start ? reread : start;
}

/** The texts may go to the database at all: the company keeps texts and the review is not hidden. */
function sendsTexts(settings: SignalSettings, review: NeutralReview): boolean {
  return settings.texts_enabled && settings.notice_published_at !== null && !review.row.is_hidden;
}

/**
 * A new review's stay may keep its text: began no earlier than the day before
 * the notice (a day of slack for time zones — the database draws the line
 * exactly, and says so for a review it knows: StoredReview.textAllowed).
 */
function mayKeepText(settings: SignalSettings, review: NeutralReview): boolean {
  if (!sendsTexts(settings, review) || review.row.arrival_date === null) {
    return false;
  }
  const notice = Date.parse(settings.notice_published_at as string);
  return Date.parse(`${review.row.arrival_date}T00:00:00Z`) >= notice - DAY_MS;
}

function hasText(texts: ReviewTexts): boolean {
  return texts.publicText !== null || texts.privateText !== null ||
    Object.keys(texts.categoryComments).length > 0;
}

/** A part of the text is still to be kept: a new review with a text, or a part that came later. */
function wantsText(settings: SignalSettings, review: NeutralReview, stored: StoredReview | undefined): boolean {
  if (!sendsTexts(settings, review) || !hasText(review.texts)) {
    return false;
  }
  if (stored === undefined) {
    return mayKeepText(settings, review);
  }
  const { publicText, privateText, categoryComments } = review.texts;
  return stored.textAllowed &&
    ((publicText !== null && !stored.publicKept) ||
      (privateText !== null && !stored.privateKept) ||
      (Object.keys(categoryComments).length > 0 && !stored.commentsKept));
}

/** The room of a building's stay is still to be learned while its days are exact. */
function wantsRoom(
  settings: SignalSettings,
  review: NeutralReview,
  stored: StoredReview | undefined,
  buildings: ReadonlySet<string>,
): boolean {
  if (!buildings.has(review.row.external_listing_id)) {
    return false;
  }
  return stored === undefined
    ? mayKeepText(settings, review)
    : stored.stayExact && !stored.roomKnown && stored.textAllowed;
}

function redactTexts(texts: ReviewTexts, names: RedactionNames): Partial<ReviewIngestRow> {
  const redact = (value: string) => redactText(value.slice(0, MAX_REDACTED_CHARS), names);
  const comments = Object.fromEntries(
    Object.entries(texts.categoryComments).map(([key, value]) => [key, redact(value)]),
  );
  return {
    public_text: texts.publicText === null ? null : redact(texts.publicText),
    private_text: texts.privateText === null ? null : redact(texts.privateText),
    category_comments: Object.keys(comments).length > 0 ? comments : null,
  };
}

function portions<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** What a booking told: the guest's names and the room it names inside its listing. */
interface BookingFacts {
  readonly names: readonly string[];
  readonly externalUnitId: string | null;
}

/** A booking the PMS no longer has: nothing to learn from it, and nothing to wait for. */
const GONE: BookingFacts = { names: [], externalUnitId: null };

/**
 * Why a booking was not read this run: it failed, the run stopped asking
 * after failures in a row, or the run's ceiling of reads is spent.
 */
type BookingMissing = "failed" | "stopped" | "capped";

const MISSING_CODES: Readonly<Record<BookingMissing, string>> = {
  failed: "booking_lookup_failed",
  stopped: "booking_lookups_stopped",
  capped: "booking_lookup_capped",
};

/** The booking reads of one run: a ceiling, and a stop once the PMS keeps failing. */
class BookingReader {
  lookups = 0;
  #failuresInARow = 0;
  readonly codes: string[] = [];

  constructor(readonly adapter: GuestSignalAdapter, readonly max: number) {}

  /** The booking, or why it could not be read this run (the code is kept). */
  async read(externalReservationId: string): Promise<BookingFacts | BookingMissing> {
    const missing: BookingMissing | null = this.#failuresInARow >= BOOKING_FAILURES_TO_STOP
      ? "stopped"
      : this.lookups >= this.max
      ? "capped"
      : null;
    if (missing !== null) {
      this.codes.push(MISSING_CODES[missing]);
      return missing;
    }
    this.lookups += 1;
    let result: NamesResult;
    try {
      result = await this.adapter.namesOf(externalReservationId);
    } catch {
      // namesOf never throws by contract; one that does is a failure like any
      // other. Only the code: the error may quote the PMS's answer.
      result = { status: "unavailable" };
    }
    if (result.status === "unavailable") {
      this.#failuresInARow += 1;
      this.codes.push(MISSING_CODES.failed);
      return "failed";
    }
    this.#failuresInARow = 0;
    return result.status === "gone" ? GONE : { names: result.names, externalUnitId: result.externalUnitId };
  }
}

const OFF_SUMMARY: Omit<SyncSummary, "status"> = {
  since: null,
  fetched: 0,
  skipped: 0,
  withTexts: 0,
  bookingLookups: 0,
  heldForNames: 0,
  textsWithoutNames: 0,
  readAgain: false,
  inserted: 0,
  updated: 0,
  cut: 0,
  journalWritten: false,
  errors: [],
};

interface Prepared {
  readonly rows: ReviewIngestRow[];
  readonly codes: string[];
  readonly withTexts: number;
  readonly bookingLookups: number;
  readonly heldForNames: number;
  readonly textsWithoutNames: number;
  readonly readAgain: boolean;
}

/** The rows of a run: keyed, redacted, with their rooms; the reviews that must wait left out. */
async function prepareRows(
  deps: ReviewSyncDeps,
  settings: SignalSettings,
  fetched: FetchedReviews,
  now: Date,
): Promise<Prepared> {
  const keys = await Promise.all(fetched.reviews.map((review) => deps.keyOf(review.row.external_id)));
  const [state, buildings, people] = await Promise.all([
    deps.store.loadState(keys),
    deps.store.buildings(),
    deps.store.redactionNames(),
  ]);
  const bookings = new BookingReader(deps.adapter, deps.maxBookingLookups ?? MAX_BOOKING_LOOKUPS);

  const rows: ReviewIngestRow[] = [];
  let withTexts = 0;
  let heldForNames = 0;
  let textsWithoutNames = 0;
  let readAgain = false;

  for (const [index, review] of fetched.reviews.entries()) {
    const key = keys[index];
    const stored = state.get(key);
    const text = wantsText(settings, review, stored);
    const room = wantsRoom(settings, review, stored, buildings);
    const reservation = review.row.external_reservation_id;
    const read = reservation !== null && (text || room) ? await bookings.read(reservation) : null;
    const booking = typeof read === "object" ? read : null;
    // Behind the ceiling a review waits whatever its age; behind a failure, for its days.
    const waits = typeof read === "string" &&
      (read === "capped" ||
        now.getTime() - Date.parse(review.row.submitted_at) <= NAME_HOLD_DAYS * DAY_MS);

    if (text && waits) {
      // The whole review waits for its booking: the next run reads it again.
      heldForNames += 1;
      readAgain = true;
      continue;
    }
    if (room && waits) {
      readAgain = true;
    }

    let row: ReviewIngestRow = {
      ...review.row,
      external_key: key,
      external_unit_id: room && booking !== null ? booking.externalUnitId : review.row.external_unit_id,
    };
    if (text) {
      const guest = [...review.guestNames, ...(booking?.names ?? [])];
      if (!hasUsableName(guest)) {
        // No name known to take out: the text does not go at all.
        textsWithoutNames += 1;
      } else {
        row = {
          ...row,
          ...redactTexts(review.texts, {
            guest,
            staff: people.staff,
            places: [...review.listingNames, ...people.places],
          }),
        };
        withTexts += 1;
      }
    }
    rows.push(row);
  }

  const codes = [
    ...Array<string>(fetched.skipped).fill("source_bad_row"),
    ...bookings.codes,
    ...Array<string>(heldForNames).fill("review_held_for_names"),
  ];
  return {
    rows,
    codes,
    withTexts,
    bookingLookups: bookings.lookups,
    heldForNames,
    textsWithoutNames,
    readAgain,
  };
}

export async function runReviewSync(deps: ReviewSyncDeps): Promise<SyncSummary> {
  const now = (deps.now ?? (() => new Date()))();

  const settings = await deps.store.settings();
  if (settings === null || !settings.sync_enabled) {
    return { status: "off", ...OFF_SUMMARY };
  }
  const { adapter } = deps;
  if (adapter.capabilities.reviews === false || adapter.fetchReviews === undefined) {
    return { status: "unsupported", ...OFF_SUMMARY };
  }

  const since = syncWindowStart(await deps.store.watermark(), now);
  let fetched: FetchedReviews;
  try {
    fetched = await adapter.fetchReviews({ since, until: now });
  } catch (error: unknown) {
    // The window is read again next time: nothing stored, the watermark stays.
    const errors = countErrors([sourceErrorCode(error)]);
    const journal = await deps.store.ingest([], null, errors, null);
    return {
      status: "failed",
      ...OFF_SUMMARY,
      since: since.toISOString(),
      readAgain: true,
      journalWritten: journal.journal_written,
      errors,
    };
  }

  const prepared = await prepareRows(deps, settings, fetched, now);
  const errors = countErrors(prepared.codes);
  const counts: RunCounts = {
    fetched: fetched.reviews.length,
    with_texts: prepared.withTexts,
    booking_lookups: prepared.bookingLookups,
    held_for_names: prepared.heldForNames,
    texts_without_names: prepared.textsWithoutNames,
  };
  const parts = portions(prepared.rows, PORTION_SIZE);
  if (parts.length === 0) {
    parts.push([]);
  }

  let inserted = 0;
  let updated = 0;
  let cut = 0;
  let journalWritten = true;
  for (const [index, part] of parts.entries()) {
    const isLast = index === parts.length - 1;
    const watermark = isLast && !prepared.readAgain ? now : null;
    const result = await deps.store.ingest(part, watermark, isLast ? errors : [], isLast ? counts : null);
    inserted += result.inserted;
    updated += result.updated;
    cut += result.cut;
    journalWritten = journalWritten && result.journal_written;
  }

  return {
    status: "done",
    since: since.toISOString(),
    fetched: fetched.reviews.length,
    skipped: fetched.skipped,
    withTexts: prepared.withTexts,
    bookingLookups: prepared.bookingLookups,
    heldForNames: prepared.heldForNames,
    textsWithoutNames: prepared.textsWithoutNames,
    readAgain: prepared.readAgain,
    inserted,
    updated,
    cut,
    journalWritten,
    errors,
  };
}
