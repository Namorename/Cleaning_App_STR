/**
 * The reading's store over supabase-js, as the service role: its state, its
 * bookings and its results, all through the functions of 20261106120000. The
 * journal lives in raw, which PostgREST does not serve.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import type { StoredProvider } from "./adapter.ts";
import { fail, readNames } from "./db.ts";
import type { HistorySlice } from "./history-plan.ts";
import type {
  HistoryFactRow,
  HistoryGrant,
  HistoryState,
  HistoryStore,
  MonthStayRow,
} from "./history-run.ts";
import { THEMES_DETECTOR } from "./themes-read.ts";
import type { RunError } from "./types.ts";

export function createHistoryStore(
  client: SupabaseClient,
  hostId: string,
  provider: StoredProvider,
): HistoryStore {
  return {
    async state(detector: string) {
      const { data, error } = await client.rpc("signal_history_state", {
        p_provider: provider,
        p_detector: detector,
        p_host_id: hostId,
      });
      if (error) fail("signal_history_state", error);
      return (data ?? null) as HistoryState | null;
    },

    redactionNames: () => readNames(client, hostId),

    async readableListings(listings: readonly string[]) {
      const { data, error } = await client.rpc("signal_history_readable", {
        p_provider: provider,
        p_listings: listings,
        p_host_id: hostId,
      });
      if (error) fail("signal_history_readable", error);
      return (data ?? []) as string[];
    },

    async reserve(slice: HistorySlice, calls: number, worstMicroUsd: number) {
      const { data, error } = await client.rpc("reserve_signal_history", {
        p_provider: provider,
        p_detector: THEMES_DETECTOR,
        p_slice_start: slice.start,
        p_slice_end: slice.end,
        p_calls: calls,
        p_worst_micro_usd: worstMicroUsd,
        p_host_id: hostId,
      });
      if (error) fail("reserve_signal_history", error);
      return data as HistoryGrant;
    },

    async complete(
      runId: number,
      facts: readonly HistoryFactRow[],
      spentMicroUsd: number,
      counts: Readonly<Record<string, number>>,
    ) {
      const { data, error } = await client.rpc("complete_signal_history", {
        p_run_id: runId,
        p_facts: facts,
        p_spent_micro_usd: spentMicroUsd,
        p_counts: counts,
      });
      if (error) fail("complete_signal_history", error);
      return data as { labels: number; labels_left_out: number };
    },

    async fail(
      runId: number,
      spentMicroUsd: number,
      counts: Readonly<Record<string, number>>,
      errors: readonly RunError[],
    ) {
      const { error } = await client.rpc("fail_signal_history", {
        p_run_id: runId,
        p_spent_micro_usd: spentMicroUsd,
        p_counts: counts,
        p_errors: errors,
      });
      if (error) fail("fail_signal_history", error);
    },

    async replaceMonthStays(month: string, rows: readonly MonthStayRow[]) {
      const { data, error } = await client.rpc("replace_property_month_stays", {
        p_provider: provider,
        p_month: month,
        p_rows: rows,
        p_host_id: hostId,
      });
      if (error) fail("replace_property_month_stays", error);
      return typeof data === "number" ? data : 0;
    },
  };
}
