/**
 * The reading run's store over supabase-js, as the service role (db.ts has
 * the load's): the queue of unread texts, the booking of model calls, and the
 * readings applied through apply_review_findings().
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import type { QueuedReview, ReviewClassifyStore } from "./classify-run.ts";
import { fail, readNames, readSettings, SOURCE } from "./db.ts";
import type { FindingInput, RunError } from "./types.ts";

const QUEUE_COLUMNS =
  "id, channel, departure_date, room_id, rating, category_ratings, public_text, private_text, " +
  "category_comments, rules_version, analysed_at, analysis_attempts";

/**
 * A kept text, and a reader that has not read it: one `or` of `and`s, so the
 * filter is a single PostgREST parameter (has text) × (rules unread, or model
 * unread with tries left).
 */
const HAS_TEXT = ["public_text.not.is.null", "private_text.not.is.null", "category_comments.not.is.null"];
const UNREAD = ["rules_version.is.null", "and(analysed_at.is.null,analysis_attempts.lt.3)"];
export const QUEUE_FILTER = HAS_TEXT.flatMap((text) => UNREAD.map((unread) => `and(${text},${unread})`))
  .join(",");

export function createClassifyStore(client: SupabaseClient, hostId: string): ReviewClassifyStore {
  return {
    settings: () => readSettings(client, hostId),

    async queue(limit: number) {
      const { data, error } = await client
        .from("guest_reviews")
        .select(QUEUE_COLUMNS)
        .eq("host_id", hostId)
        .or(QUEUE_FILTER)
        .order("submitted_at", { ascending: false })
        .limit(limit);
      if (error) fail("Reading the queue", error);
      return (data ?? []) as unknown as QueuedReview[];
    },

    async reserveCalls(wanted: number) {
      const { data, error } = await client.rpc("reserve_review_model_calls", {
        p_source: SOURCE,
        p_wanted: wanted,
        p_host_id: hostId,
      });
      if (error) fail("reserve_review_model_calls", error);
      return typeof data === "number" ? data : 0;
    },

    async apply(reviewId: string, detector: string, language: string | null, findings: readonly FindingInput[]) {
      const { data, error } = await client.rpc("apply_review_findings", {
        p_review_id: reviewId,
        p_detector: detector,
        p_language: language,
        p_findings: findings,
      });
      if (error) fail("apply_review_findings", error);
      return (data ?? {}) as Record<string, number>;
    },

    async markFailed(reviewId: string, code: string) {
      const { error } = await client.rpc("mark_review_analysis_failed", {
        p_review_id: reviewId,
        p_error: code,
      });
      if (error) fail("mark_review_analysis_failed", error);
    },

    async forbiddenWords() {
      const { staff, places } = await readNames(client, hostId);
      return [...staff, ...places].flatMap((name) => name.split(/[\s\-'’.,|/]+/u));
    },

    async log(isOk: boolean, counts: Readonly<Record<string, number>>, errors: readonly RunError[]) {
      const { error } = await client.rpc("log_review_run", {
        p_source: SOURCE,
        p_stage: "classify",
        p_is_ok: isOk,
        p_counts: counts,
        p_errors: errors,
        p_host_id: hostId,
      });
      if (error) fail("log_review_run", error);
    },
  };
}
