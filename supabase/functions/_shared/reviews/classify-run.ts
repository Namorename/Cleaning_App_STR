/**
 * One run of classify-reviews (docs/reviews-to-tasks.md §3.1, §5): the
 * reviews whose kept text a reader has not read, newest first; the model's
 * reading first, the rules' after it, each applied through
 * apply_review_findings() — which stores, decides and, once a review is
 * settled, cuts its stay to the month.
 *
 * - Model calls are booked before they are made (reserve_review_model_calls):
 *   two runs at once never double the ceiling, and a run the platform kills
 *   has already counted what it took.
 * - Rules are free and read every review the rules have not read, whatever
 *   the model does; a review the model reads later gets its words then.
 * - A failure is the service's or the review's (classify.ts). An unknown one
 *   is judged by the next review: a failure again — the service; the run
 *   stops calling the model, and neither review spends an attempt. A success
 *   — the first review's own; it spends one. So a review the call always
 *   fails on cannot hold the head of the queue for ever, and an outage of
 *   days cannot push every review out of it.
 */

import {
  MODEL_DETECTOR,
  type ModelClient,
  ModelError,
  type ModelInput,
  parseReading,
  toModelError,
} from "./classify.ts";
import { readByRules, RULES_DETECTOR } from "./rules.ts";
import {
  countErrors,
  type FindingInput,
  type ReviewChannel,
  type ReviewSettings,
  type ReviewTexts,
  type RunError,
} from "./types.ts";

/** How many reviews one run takes off the queue, whatever the ceiling. */
export const QUEUE_LIMIT = 200;

/** A review waiting for a reader, as the queue hands it. */
export interface QueuedReview {
  readonly id: string;
  readonly channel: ReviewChannel;
  readonly departure_date: string | null;
  readonly room_id: number | null;
  readonly rating: number | null;
  readonly category_ratings: Readonly<Record<string, number>>;
  readonly public_text: string | null;
  readonly private_text: string | null;
  readonly category_comments: Readonly<Record<string, string>> | null;
  readonly rules_version: string | null;
  readonly analysed_at: string | null;
  readonly analysis_attempts: number;
}

/** What a run reads from the database and writes into it. */
export interface ReviewClassifyStore {
  settings(): Promise<ReviewSettings | null>;
  /** Reviews with a kept text the rules or the model have not read, newest first. */
  queue(limit: number): Promise<readonly QueuedReview[]>;
  /** Books up to `wanted` model calls under today's ceiling; how many were granted. */
  reserveCalls(wanted: number): Promise<number>;
  apply(
    reviewId: string,
    detector: string,
    language: string | null,
    findings: readonly FindingInput[],
  ): Promise<Readonly<Record<string, number>>>;
  markFailed(reviewId: string, code: string): Promise<void>;
  /** Words a technician's title may not carry: the company's people and places. */
  forbiddenWords(): Promise<readonly string[]>;
  log(
    isOk: boolean,
    counts: Readonly<Record<string, number>>,
    errors: readonly RunError[],
  ): Promise<void>;
}

export interface ReviewClassifyDeps {
  readonly store: ReviewClassifyStore;
  /** Null when the function has no key: the rules read alone. */
  readonly model: ModelClient | null;
}

export interface ClassifySummary {
  readonly status: "off" | "done";
  readonly queued: number;
  readonly modelCalls: number;
  readonly modelRead: number;
  readonly rulesRead: number;
  readonly invalid: number;
  readonly decided: Readonly<Record<string, number>>;
  readonly stoppedModel: string | null;
  readonly errors: readonly RunError[];
}

function textsOf(review: QueuedReview): ReviewTexts {
  return {
    publicText: review.public_text,
    privateText: review.private_text,
    categoryComments: review.category_comments ?? {},
  };
}

export function modelInputOf(review: QueuedReview): ModelInput {
  return {
    channel: review.channel,
    departureMonth: review.departure_date === null ? null : review.departure_date.slice(0, 7),
    placeKind: review.room_id === null ? "flat" : "room",
    rating: review.rating,
    categoryRatings: review.category_ratings,
    texts: textsOf(review),
  };
}

function needsModel(review: QueuedReview): boolean {
  return review.analysed_at === null && review.analysis_attempts < 3;
}

function add(into: Record<string, number>, counts: Readonly<Record<string, number>>): void {
  for (const [key, value] of Object.entries(counts)) {
    into[key] = (into[key] ?? 0) + value;
  }
}

const OFF: ClassifySummary = {
  status: "off",
  queued: 0,
  modelCalls: 0,
  modelRead: 0,
  rulesRead: 0,
  invalid: 0,
  decided: {},
  stoppedModel: null,
  errors: [],
};

export async function runReviewClassify(deps: ReviewClassifyDeps): Promise<ClassifySummary> {
  const { store, model } = deps;
  const settings = await store.settings();
  if (settings === null || !settings.texts_enabled) {
    return OFF;
  }

  const queue = await store.queue(QUEUE_LIMIT);
  const reader = settings.model_enabled ? model : null;
  const forbidden = reader !== null ? await store.forbiddenWords() : [];
  const wanted = reader !== null ? queue.filter(needsModel).length : 0;
  let calls = wanted > 0 ? await store.reserveCalls(wanted) : 0;
  const booked = calls;

  const codes: string[] = [];
  const decided: Record<string, number> = {};
  let modelRead = 0;
  let rulesRead = 0;
  let invalid = 0;
  let stoppedModel: string | null = null;
  // An unknown failure waits for the next review to say whose it was.
  let pending: { readonly id: string; readonly code: string } | null = null;

  const fail = async (reviewId: string, code: string): Promise<void> => {
    await store.markFailed(reviewId, code);
    codes.push(code);
  };

  /** The service failed: both reviews are spared, and the model rests until tomorrow. */
  const stopModel = async (code: string, reviewId: string): Promise<void> => {
    stoppedModel = code;
    const service = code.startsWith("service_") ? code : "service_unavailable";
    await fail(reviewId, service);
    if (pending !== null) {
      await fail(pending.id, service);
      pending = null;
    }
  };

  for (const review of queue) {
    if (reader !== null && stoppedModel === null && calls > 0 && needsModel(review)) {
      calls -= 1;
      const input = modelInputOf(review);
      try {
        const reading = parseReading(await reader.read(input), input, forbidden);
        add(decided, await store.apply(review.id, MODEL_DETECTOR, reading.language, reading.findings));
        modelRead += 1;
        invalid += reading.invalid;
        if (pending !== null) {
          // The call works: the review before failed on its own.
          await fail(pending.id, pending.code);
          pending = null;
        }
      } catch (error: unknown) {
        const failure = error instanceof ModelError ? error : toModelError(error);
        if (failure.scope === "service") {
          await stopModel(failure.code, review.id);
        } else if (failure.scope === "review") {
          await fail(review.id, failure.code);
        } else if (pending !== null) {
          await stopModel(failure.code, review.id);
        } else {
          pending = { id: review.id, code: failure.code };
        }
      }
    }

    if (review.rules_version === null) {
      add(decided, await store.apply(review.id, RULES_DETECTOR, null, readByRules(textsOf(review))));
      rulesRead += 1;
    }
  }

  // The last review failed with nobody after it to judge: not counted against it.
  if (pending !== null) {
    await fail(pending.id, "service_unconfirmed");
    pending = null;
  }

  const errors = countErrors(codes);
  await store.log(stoppedModel === null, {
    read: queue.length,
    model_read: modelRead,
    rules_read: rulesRead,
    invalid,
    booked_unused: calls,
    ...decided,
  }, errors);

  return {
    status: "done",
    queued: queue.length,
    modelCalls: booked - calls,
    modelRead,
    rulesRead,
    invalid,
    decided,
    stoppedModel,
    errors,
  };
}
