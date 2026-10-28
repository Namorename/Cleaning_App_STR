/**
 * The runs' stores over supabase-js, as the service role (the jobs'
 * functions are granted to it alone, docs/reviews-to-tasks.md §2.2). Reads go
 * to the tables the service role may select; every write is an RPC of
 * 20261029110000_reviews_to_tasks.sql. One company: the one there is
 * (default_host_id) until F25 phase B passes its own.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import type { IngestResult, ReviewSyncStore, RunCounts, StoredReview } from "./sync.ts";
import type { NeutralReviewRow, ReviewSettings, RunError } from "./types.ts";

export const SOURCE = "hostaway";

const SETTINGS_COLUMNS =
  "sync_enabled, texts_enabled, tasks_enabled, model_enabled, model_since, daily_model_cap, " +
  "notice_published_at";

/** Keys asked of review_load_state at once: a run reads ≈ 30 a day, a Sunday ≈ 1 000. */
const STATE_PORTION = 500;

interface LoadStateRow {
  readonly external_key: string;
  readonly public_kept: boolean;
  readonly private_kept: boolean;
  readonly comments_kept: boolean;
  readonly text_allowed: boolean;
  readonly stay_exact: boolean;
  readonly room_known: boolean;
}

const LOAD_STATE_FLAGS = [
  "public_kept",
  "private_kept",
  "comments_kept",
  "text_allowed",
  "stay_exact",
  "room_known",
] as const;

export function isLoadStateRow(row: unknown): row is LoadStateRow {
  if (typeof row !== "object" || row === null) {
    return false;
  }
  const value = row as Record<string, unknown>;
  return typeof value.external_key === "string" &&
    LOAD_STATE_FLAGS.every((flag) => typeof value[flag] === "boolean");
}

export function fail(what: string, error: { message: string }): never {
  throw new Error(`${what} failed: ${error.message}`);
}

export async function defaultHostId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.rpc("default_host_id");
  if (error) fail("default_host_id", error);
  if (typeof data !== "string") {
    throw new Error("There is no company to load reviews for");
  }
  return data;
}

export async function readSettings(client: SupabaseClient, hostId: string): Promise<ReviewSettings | null> {
  const { data, error } = await client
    .from("review_settings")
    .select(SETTINGS_COLUMNS)
    .eq("host_id", hostId)
    .maybeSingle();
  if (error) fail("Reading review_settings", error);
  return (data as ReviewSettings | null) ?? null;
}

/** Words of the company's people and places, for the redaction and the titles' check. */
export async function readNames(
  client: SupabaseClient,
  hostId: string,
): Promise<{ staff: string[]; places: string[] }> {
  const [people, places] = await Promise.all([
    client.from("profiles").select("full_name").eq("host_id", hostId).not("full_name", "is", null),
    client.from("properties").select("name").eq("host_id", hostId),
  ]);
  if (people.error) fail("Reading profiles", people.error);
  if (places.error) fail("Reading properties", places.error);
  return {
    staff: (people.data ?? []).map((row) => String(row.full_name)),
    places: (places.data ?? []).map((row) => String(row.name)),
  };
}

export function createSyncStore(client: SupabaseClient, hostId: string): ReviewSyncStore {
  return {
    settings: () => readSettings(client, hostId),

    async watermark() {
      const { data, error } = await client.rpc("review_sync_watermark", {
        p_source: SOURCE,
        p_host_id: hostId,
      });
      if (error) fail("review_sync_watermark", error);
      return typeof data === "string" ? new Date(data) : null;
    },

    async buildings() {
      const { data, error } = await client
        .from("properties")
        .select("parent_id")
        .eq("host_id", hostId)
        .not("parent_id", "is", null);
      if (error) fail("Reading rooms", error);
      return new Set((data ?? []).map((row) => Number(row.parent_id)));
    },

    redactionNames: () => readNames(client, hostId),

    async loadState(keys: readonly string[]) {
      const state = new Map<string, StoredReview>();
      for (let i = 0; i < keys.length; i += STATE_PORTION) {
        const { data, error } = await client.rpc("review_load_state", {
          p_source: SOURCE,
          p_keys: keys.slice(i, i + STATE_PORTION),
          p_host_id: hostId,
        });
        if (error) fail("review_load_state", error);
        for (const row of (data ?? []) as unknown[]) {
          if (!isLoadStateRow(row)) {
            // A renamed column would read as "nothing kept" and re-send every text.
            throw new Error("review_load_state returned a row of an unexpected shape");
          }
          state.set(row.external_key, {
            publicKept: row.public_kept,
            privateKept: row.private_kept,
            commentsKept: row.comments_kept,
            textAllowed: row.text_allowed,
            stayExact: row.stay_exact,
            roomKnown: row.room_known,
          });
        }
      }
      return state;
    },

    async ingest(
      rows: readonly NeutralReviewRow[],
      watermark: Date | null,
      errors: readonly RunError[],
      counts: RunCounts | null,
    ) {
      const { data, error } = await client.rpc("ingest_guest_reviews", {
        p_source: SOURCE,
        p_rows: rows,
        p_watermark: watermark?.toISOString() ?? null,
        p_host_id: hostId,
        p_errors: errors,
        p_counts: counts,
      });
      if (error) fail("ingest_guest_reviews", error);
      const result = (data ?? {}) as Partial<IngestResult>;
      return {
        inserted: result.inserted ?? 0,
        updated: result.updated ?? 0,
        cut: result.cut ?? 0,
        journal_written: result.journal_written ?? false,
      };
    },
  };
}
