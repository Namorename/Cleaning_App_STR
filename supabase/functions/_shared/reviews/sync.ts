/**
 * One run of sync-reviews (docs/reviews-to-tasks.md §5): the PMS's published
 * reviews since the watermark, through the adapter, into
 * ingest_guest_reviews() in portions. The database decides what is kept —
 * texts only for stays after the guest notice, never for hidden reviews or
 * places in the archive, the stay cut to its month once nothing waits on it;
 * this run only sends.
 *
 * - From the watermark minus three days (a review can appear a little after
 *   the time it says it was sent), the history of twelve months on the first
 *   run; on Sundays the last hundred days again, to see hidings and replies.
 * - Texts are redacted here, in memory, before they leave the function, and
 *   sent only while the company keeps texts and the review is not hidden.
 * - A room is asked of the PMS only for a review of a building whose text
 *   may be kept: only those can become work.
 * - Only the last portion moves the watermark: a run cut short reads the
 *   same window again, and the upsert makes that harmless.
 */

import { redactText, type RedactionNames } from "./redact.ts";
import {
  countErrors,
  type FetchedReviews,
  type NeutralReviewRow,
  type ReviewSettings,
  type ReviewSourceAdapter,
  ReviewSourceError,
  type ReviewTexts,
  type RunError,
  type SourceReview,
} from "./types.ts";

export const SYNC_OVERLAP_DAYS = 3;
export const HISTORY_DAYS = 365;
export const SUNDAY_REREAD_DAYS = 100;
export const PORTION_SIZE = 500;
/** A bound on the PMS calls for rooms in one run; ≈ 2–3 a day are expected (docs §1.3). */
export const MAX_ROOM_LOOKUPS = 20;

const DAY_MS = 86_400_000;

export interface IngestResult {
  readonly inserted: number;
  readonly updated: number;
  readonly cut: number;
  readonly journal_written: boolean;
}

/** What a run reads from the database and writes into it. */
export interface ReviewSyncStore {
  settings(): Promise<ReviewSettings | null>;
  watermark(): Promise<Date | null>;
  /** Our listings that have rooms under them. */
  buildings(): Promise<ReadonlySet<number>>;
  /** The company's people and places, to strip from the texts. */
  redactionNames(): Promise<Pick<RedactionNames, "staff" | "places">>;
  ingest(
    rows: readonly NeutralReviewRow[],
    watermark: Date | null,
    errors: readonly RunError[],
  ): Promise<IngestResult>;
}

export interface ReviewSyncDeps {
  readonly store: ReviewSyncStore;
  readonly adapter: ReviewSourceAdapter;
  readonly now?: () => Date;
  readonly maxRoomLookups?: number;
}

export interface SyncSummary {
  readonly status: "off" | "done" | "failed";
  readonly since: string | null;
  readonly fetched: number;
  readonly skipped: number;
  readonly withTexts: number;
  readonly roomLookups: number;
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
function sendsTexts(settings: ReviewSettings, review: SourceReview): boolean {
  return settings.texts_enabled && settings.notice_published_at !== null && !review.row.is_hidden;
}

/**
 * The stay may keep its text: began no earlier than the day before the notice
 * (a day of slack for time zones — the database draws the line exactly).
 */
function mayKeepText(settings: ReviewSettings, review: SourceReview): boolean {
  if (!sendsTexts(settings, review) || review.row.arrival_date === null) {
    return false;
  }
  const notice = Date.parse(settings.notice_published_at as string);
  return Date.parse(`${review.row.arrival_date}T00:00:00Z`) >= notice - DAY_MS;
}

function redactTexts(texts: ReviewTexts, names: RedactionNames): Partial<NeutralReviewRow> {
  const comments = Object.fromEntries(
    Object.entries(texts.categoryComments).map(([key, value]) => [key, redactText(value, names)]),
  );
  return {
    public_text: texts.publicText === null ? null : redactText(texts.publicText, names),
    private_text: texts.privateText === null ? null : redactText(texts.privateText, names),
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

function codeOf(error: unknown): string {
  return error instanceof ReviewSourceError ? error.code : "source_unavailable";
}

export async function runReviewSync(deps: ReviewSyncDeps): Promise<SyncSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const maxLookups = deps.maxRoomLookups ?? MAX_ROOM_LOOKUPS;
  const empty: Omit<SyncSummary, "status"> = {
    since: null,
    fetched: 0,
    skipped: 0,
    withTexts: 0,
    roomLookups: 0,
    inserted: 0,
    updated: 0,
    cut: 0,
    journalWritten: false,
    errors: [],
  };

  const settings = await deps.store.settings();
  if (settings === null || !settings.sync_enabled) {
    return { status: "off", ...empty };
  }

  const since = syncWindowStart(await deps.store.watermark(), now);
  let fetched: FetchedReviews;
  try {
    fetched = await deps.adapter.fetchPublished(since, now);
  } catch (error: unknown) {
    // The window is read again next time: nothing stored, the watermark stays.
    const errors = countErrors([codeOf(error)]);
    const journal = await deps.store.ingest([], null, errors);
    return {
      status: "failed",
      ...empty,
      since: since.toISOString(),
      journalWritten: journal.journal_written,
      errors,
    };
  }

  const [buildings, people] = await Promise.all([
    deps.store.buildings(),
    deps.store.redactionNames(),
  ]);

  const codes: string[] = fetched.skipped > 0 ? Array(fetched.skipped).fill("source_bad_row") : [];
  const rows: NeutralReviewRow[] = [];
  let withTexts = 0;
  let roomLookups = 0;

  for (const review of fetched.reviews) {
    let row: NeutralReviewRow = review.row;

    if (sendsTexts(settings, review)) {
      const names: RedactionNames = {
        guest: review.guestNames,
        staff: people.staff,
        places: [...review.listingNames, ...people.places],
      };
      row = { ...row, ...redactTexts(review.texts, names) };
      withTexts += 1;
    }

    const isBuilding = row.listing_id !== null && buildings.has(row.listing_id);
    if (isBuilding && mayKeepText(settings, review)) {
      if (roomLookups >= maxLookups) {
        codes.push("room_lookup_capped");
      } else {
        roomLookups += 1;
        try {
          row = { ...row, room_id: await deps.adapter.roomOf(review) };
        } catch {
          codes.push("room_lookup_failed");
        }
      }
    }

    rows.push(row);
  }

  const errors = countErrors(codes);
  const parts = portions(rows, PORTION_SIZE);
  if (parts.length === 0) {
    parts.push([]);
  }

  let inserted = 0;
  let updated = 0;
  let cut = 0;
  let journalWritten = true;
  for (const [index, part] of parts.entries()) {
    const isLast = index === parts.length - 1;
    const result = await deps.store.ingest(part, isLast ? now : null, isLast ? errors : []);
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
    withTexts,
    roomLookups,
    inserted,
    updated,
    cut,
    journalWritten,
    errors,
  };
}
