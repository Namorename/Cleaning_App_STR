/**
 * One tick of read-signal-history (docs/property-intelligence-plan.md §4.4): at
 * most one month of stays and one week of past reviews, then it stops. Texts are
 * read here, in memory, and go nowhere but to the model, redacted; what leaves
 * this function is labels and counts.
 *
 * - Nothing happens while history_enabled is off, whatever the job does.
 * - How far back is the PMS's to say and the company's to narrow: the core holds
 *   no depth of its own (history-source.ts).
 * - The calls of a week are booked first, at their worst case, as one piece: a
 *   day's ceiling or a budget that cannot take the whole week stops the run with
 *   a reason, and the week stays open. Only what the database grants is read.
 * - A review the model cannot read costs itself. The service failing stops the
 *   run: the week is not closed, nothing of it is stored, and the money stays
 *   counted. A call that failed is counted at its worst case: its tokens are not
 *   known, and the budget must not be the thing that guesses low.
 * - A name goes before a text goes, as in sync.ts: with no usable name known the
 *   text is not read at all.
 */

import { sourceErrorCode } from "./adapter.ts";
import type { NeutralReview } from "./adapter.ts";
import type { HistorySource, ListingBirth, NeutralStayFact } from "./history-source.ts";
import {
  floorOf,
  type HistoryMonth,
  type HistoryPlan,
  type HistorySlice,
  nextStayMonth,
  planHistory,
  windowOf,
} from "./history-plan.ts";
import type { SignalKeyer } from "./key.ts";
import { hasUsableName, redactText, type RedactionNames } from "./redact.ts";
import {
  costMicroUsd,
  parseThemes,
  THEMES_DETECTOR,
  THEMES_MAX_TEXT_CHARS,
  type ThemeInput,
  type ThemeLabel,
  type ThemeModelClient,
  WORST_CALL_MICRO_USD,
} from "./themes-read.ts";
import { ModelError } from "./classify.ts";
import { countErrors, type RunError, type SignalChannel } from "./types.ts";

/** Reviews read at a time: a week of 126 fits one run, far under the platform's clock. */
export const HISTORY_CONCURRENCY = 4;
/** Unknown failures in a row after which the service, not the review, is to blame. */
const UNKNOWN_FAILURES_TO_STOP = 2;

/** signal_history_state(). */
export interface HistoryState {
  readonly enabled: boolean;
  readonly depth_months: number;
  readonly include_private: boolean;
  /** The reading goes on past the texts' line, under the same limits. */
  readonly follow: boolean;
  readonly daily_cap: number;
  readonly budget_micro_usd: number;
  readonly min_confidence: number;
  readonly spent_micro_usd: number;
  readonly calls_today: number;
  /** The texts' line as a Prague day. */
  readonly line: string | null;
  readonly reviews_done: readonly string[];
  /** A week → its attempts of the last two days that did not close it. */
  readonly reviews_stuck: Readonly<Record<string, number>>;
  /** A month's first day → when its stays were last read. */
  readonly stays_done: Readonly<Record<string, string>>;
}

export type HistoryGrant =
  | { readonly granted: true; readonly run_id: number }
  | { readonly granted: false; readonly reason: string };

/** One label for complete_signal_history(): the PMS's ids and the review's key, no text. */
export interface HistoryFactRow {
  readonly external_listing_id: string;
  readonly external_key: string;
  readonly theme: string;
  readonly severity: string;
  readonly confidence: number;
  readonly channel: SignalChannel;
  readonly departure_date: string;
}

/** One line of replace_property_month_stays(). */
export interface MonthStayRow {
  readonly external_listing_id: string;
  readonly channel: SignalChannel;
  readonly stays: number;
  readonly nights: number;
}

export interface HistoryStore {
  state(detector: string): Promise<HistoryState | null>;
  redactionNames(): Promise<Pick<RedactionNames, "staff" | "places">>;
  /** Of these PMS listings, the ones the company holds and works: no other text goes to the model. */
  readableListings(listings: readonly string[]): Promise<readonly string[]>;
  reserve(slice: HistorySlice, calls: number, worstMicroUsd: number): Promise<HistoryGrant>;
  complete(
    runId: number,
    facts: readonly HistoryFactRow[],
    spentMicroUsd: number,
    counts: Readonly<Record<string, number>>,
  ): Promise<{ readonly labels: number; readonly labels_left_out: number }>;
  fail(
    runId: number,
    spentMicroUsd: number,
    counts: Readonly<Record<string, number>>,
    errors: readonly RunError[],
  ): Promise<void>;
  replaceMonthStays(month: string, rows: readonly MonthStayRow[]): Promise<number>;
}

export interface HistoryDeps {
  readonly store: HistoryStore;
  readonly source: HistorySource;
  /** Null when the function has no key: stays are read, reviews wait. */
  readonly model: ThemeModelClient | null;
  readonly keyOf: SignalKeyer;
  readonly now?: () => Date;
}

export interface HistorySummary {
  readonly status: "off" | "done";
  readonly stayMonth: string | null;
  readonly stayRows: number;
  readonly week: string | null;
  readonly weeksLeft: number;
  readonly labels: number;
  readonly counts: Readonly<Record<string, number>>;
  /** Why the week was not read: a code, or the database's reason. */
  readonly stopped: string | null;
  readonly errors: readonly RunError[];
}

const OFF: HistorySummary = {
  status: "off",
  stayMonth: null,
  stayRows: 0,
  week: null,
  weeksLeft: 0,
  labels: 0,
  counts: {},
  stopped: null,
  errors: [],
};

function birthsOf(births: readonly ListingBirth[]): ReadonlyMap<string, string | null> {
  return new Map(births.map((birth) => [birth.external_listing_id, birth.born_on]));
}

/**
 * Stays of a month as lines, one a listing and channel. A stay before a floor counts as nothing,
 * and so does one that has not ended: an episode can only come from a stay that is over, and a
 * booking of next week in the sum would make the present month look better than it is.
 */
export function monthRows(
  facts: readonly NeutralStayFact[],
  from: string,
  births: ReadonlyMap<string, string | null>,
  today: string,
): MonthStayRow[] {
  const rows = new Map<string, MonthStayRow>();
  for (const fact of facts) {
    if (
      fact.departure_date > today ||
      fact.departure_date < floorOf(from, births.get(fact.external_listing_id))
    ) {
      continue;
    }
    const key = `${fact.external_listing_id}:${fact.channel}`;
    const known = rows.get(key);
    rows.set(key, {
      external_listing_id: fact.external_listing_id,
      channel: fact.channel,
      stays: (known?.stays ?? 0) + 1,
      nights: (known?.nights ?? 0) + fact.nights,
    });
  }
  return [...rows.values()];
}

/** The reviews of a week worth a call, and why the others are not. */
export function selectReviews(
  reviews: readonly NeutralReview[],
  state: Pick<HistoryState, "line" | "include_private">,
  from: string,
  births: ReadonlyMap<string, string | null>,
): { readonly chosen: NeutralReview[]; readonly counts: Record<string, number> } {
  const counts = { hidden: 0, no_text: 0, after_line: 0, below_floor: 0 };
  const chosen: NeutralReview[] = [];
  for (const review of reviews) {
    const { row, texts } = review;
    const stayEnd = row.departure_date;
    const hasText = texts.publicText !== null || (state.include_private && texts.privateText !== null);
    if (row.is_hidden) {
      counts.hidden += 1;
    } else if (!hasText || stayEnd === null) {
      counts.no_text += 1;
    } else if (state.line !== null && (row.arrival_date ?? stayEnd) >= state.line) {
      counts.after_line += 1;
    } else if (stayEnd < floorOf(from, births.get(row.external_listing_id))) {
      counts.below_floor += 1;
    } else {
      chosen.push(review);
    }
  }
  return { chosen, counts };
}

function themeInputOf(
  review: NeutralReview,
  names: RedactionNames,
  includePrivate: boolean,
): ThemeInput {
  const redact = (value: string | null): string | null =>
    value === null ? null : redactText(value.slice(0, THEMES_MAX_TEXT_CHARS), names);
  return {
    rating: review.row.rating,
    publicText: redact(review.texts.publicText),
    privateText: includePrivate ? redact(review.texts.privateText) : null,
  };
}

interface WeekOutcome {
  readonly labels: ReadonlyMap<NeutralReview, readonly ThemeLabel[]>;
  readonly read: number;
  readonly failed: number;
  readonly invalid: number;
  readonly spentMicroUsd: number;
  readonly stopped: string | null;
  readonly codes: readonly string[];
}

/** Reads a week's reviews a few at a time; a service failure stops every worker. */
async function readWeek(
  model: ThemeModelClient,
  inputs: readonly { readonly review: NeutralReview; readonly input: ThemeInput }[],
): Promise<WeekOutcome> {
  const labels = new Map<NeutralReview, readonly ThemeLabel[]>();
  const codes: string[] = [];
  let next = 0;
  let read = 0;
  let failed = 0;
  let invalid = 0;
  let spent = 0;
  let unknownInARow = 0;
  let stopped: string | null = null;

  const worker = async (): Promise<void> => {
    while (stopped === null && next < inputs.length) {
      const item = inputs[next];
      next += 1;
      try {
        const reading = await model.read(item.input);
        spent += costMicroUsd(reading);
        const answer = parseThemes(reading.raw);
        labels.set(item.review, answer.labels);
        invalid += answer.invalid;
        read += 1;
        unknownInARow = 0;
      } catch (error: unknown) {
        spent += WORST_CALL_MICRO_USD;
        failed += 1;
        const failure = error instanceof ModelError
          ? error
          : new ModelError("model_failed", "unknown", "The call failed");
        codes.push(failure.code);
        unknownInARow = failure.scope === "unknown" ? unknownInARow + 1 : 0;
        if (failure.scope === "service" || unknownInARow >= UNKNOWN_FAILURES_TO_STOP) {
          stopped = failure.code;
        }
      }
    }
  };

  await Promise.all(Array.from({ length: HISTORY_CONCURRENCY }, worker));
  return { labels, read, failed, invalid, spentMicroUsd: spent, stopped, codes };
}

/** Labels above the floor, as the rows the database takes. */
async function factRows(
  outcome: WeekOutcome,
  keyOf: SignalKeyer,
  minConfidence: number,
): Promise<{ readonly rows: HistoryFactRow[]; readonly unsure: number }> {
  const rows: HistoryFactRow[] = [];
  let unsure = 0;
  for (const [review, labels] of outcome.labels) {
    const key = await keyOf(review.row.external_id);
    for (const label of labels) {
      if (label.confidence < minConfidence) {
        unsure += 1;
        continue;
      }
      rows.push({
        external_listing_id: review.row.external_listing_id,
        external_key: key,
        theme: label.theme,
        severity: label.severity,
        confidence: Math.round(label.confidence * 100) / 100,
        channel: review.row.channel,
        departure_date: review.row.departure_date as string,
      });
    }
  }
  return { rows, unsure };
}

async function readStays(
  deps: HistoryDeps,
  month: HistoryMonth,
  from: string,
  births: ReadonlyMap<string, string | null>,
  today: string,
): Promise<number> {
  const facts = await deps.source.fetchStayFacts(windowOf(month));
  return await deps.store.replaceMonthStays(month.start, monthRows(facts, from, births, today));
}

async function readReviews(
  deps: HistoryDeps,
  model: ThemeModelClient,
  state: HistoryState,
  plan: HistoryPlan,
  week: HistorySlice,
  births: ReadonlyMap<string, string | null>,
): Promise<Pick<HistorySummary, "labels" | "counts" | "stopped" | "errors" | "weeksLeft">> {
  const window = windowOf(week);
  const [fetched, bookingNames, people] = await Promise.all([
    deps.source.fetchReviewsByStay(window),
    deps.source.stayGuestNames(window),
    deps.store.redactionNames(),
  ]);
  const { chosen: selected, counts } = selectReviews(
    fetched.reviews,
    { line: state.follow ? null : state.line, include_private: state.include_private },
    plan.from,
    births,
  );
  const readable = new Set(
    await deps.store.readableListings([...new Set(selected.map((review) => review.row.external_listing_id))]),
  );
  const chosen = selected.filter((review) => readable.has(review.row.external_listing_id));

  const inputs: { readonly review: NeutralReview; readonly input: ThemeInput }[] = [];
  let noNames = 0;
  for (const review of chosen) {
    const reservation = review.row.external_reservation_id;
    const guest = [
      ...review.guestNames,
      ...(reservation !== null ? bookingNames.get(reservation) ?? [] : []),
    ];
    if (!hasUsableName(guest)) {
      noNames += 1;
      continue;
    }
    inputs.push({
      review,
      input: themeInputOf(
        review,
        { guest, staff: people.staff, places: [...review.listingNames, ...people.places] },
        state.include_private,
      ),
    });
  }

  const grant = await deps.store.reserve(week, inputs.length, WORST_CALL_MICRO_USD);
  if (!grant.granted) {
    return { labels: 0, counts: {}, stopped: grant.reason, errors: [], weeksLeft: plan.weeksLeft };
  }

  const outcome = await readWeek(model, inputs);
  const { rows, unsure } = await factRows(outcome, deps.keyOf, state.min_confidence);
  const weekCounts: Record<string, number> = {
    ...counts,
    fetched: fetched.reviews.length,
    skipped_rows: fetched.skipped,
    no_names: noNames,
    not_ours: selected.length - chosen.length,
    read: outcome.read,
    failed: outcome.failed,
    invalid: outcome.invalid,
    unsure,
    weeks_total: plan.weeksTotal,
    weeks_left: outcome.stopped === null ? plan.weeksLeft - 1 : plan.weeksLeft,
  };
  const errors = countErrors(outcome.codes);

  if (outcome.stopped !== null) {
    await deps.store.fail(grant.run_id, outcome.spentMicroUsd, weekCounts, errors);
    return {
      labels: 0,
      counts: weekCounts,
      stopped: outcome.stopped,
      errors,
      weeksLeft: plan.weeksLeft,
    };
  }

  const done = await deps.store.complete(grant.run_id, rows, outcome.spentMicroUsd, weekCounts);
  return {
    labels: done.labels,
    counts: { ...weekCounts, labels_left_out: done.labels_left_out },
    stopped: null,
    errors,
    weeksLeft: plan.weeksLeft - 1,
  };
}

export async function runHistory(deps: HistoryDeps): Promise<HistorySummary> {
  const state = await deps.store.state(THEMES_DETECTOR);
  if (state === null || !state.enabled) {
    return OFF;
  }

  const today = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const plan = planHistory({
    today,
    depthMonths: Math.min(deps.source.history.maxDepthMonths, state.depth_months),
    line: state.line,
    done: state.reviews_done,
    stuck: state.reviews_stuck,
    follow: state.follow,
  });
  const month = nextStayMonth(plan.months, state.stays_done, today);
  const week = deps.model !== null ? plan.next : null;
  if (month === null && week === null) {
    return { ...OFF, status: "done", weeksLeft: plan.weeksLeft };
  }

  let births: ReadonlyMap<string, string | null>;
  try {
    births = birthsOf(await deps.source.fetchListingBirths());
  } catch (error: unknown) {
    return failedOnSource(error, plan);
  }

  // A month that cannot be read does not hold the reviews back: each part fails on its own.
  let stayRows = 0;
  let stayError: readonly RunError[] = [];
  if (month !== null) {
    try {
      stayRows = await readStays(deps, month, plan.from, births, today);
    } catch (error: unknown) {
      stayError = countErrors([sourceErrorCode(error)]);
    }
  }

  const base = {
    status: "done" as const,
    stayMonth: month?.start ?? null,
    stayRows,
    week: week?.start ?? null,
  };
  if (week === null || deps.model === null) {
    return {
      ...base,
      labels: 0,
      counts: {},
      stopped: stayError[0]?.code ?? null,
      errors: stayError,
      weeksLeft: plan.weeksLeft,
    };
  }
  try {
    const read = await readReviews(deps, deps.model, state, plan, week, births);
    return { ...base, ...read, errors: [...stayError, ...read.errors] };
  } catch (error: unknown) {
    const failed = failedOnSource(error, plan);
    return { ...failed, ...base, errors: [...stayError, ...failed.errors] };
  }
}

/** A failure of the PMS: nothing was reserved, the next tick reads the same again. */
function failedOnSource(error: unknown, plan: HistoryPlan): HistorySummary {
  const code = sourceErrorCode(error);
  return {
    ...OFF,
    status: "done",
    weeksLeft: plan.weeksLeft,
    stopped: code,
    errors: countErrors([code]),
  };
}
