/**
 * The store of read-guest-messages over supabase-js, as the service role: the
 * functions of 20261110120000 (docs/guest-chats.md) and the journal every job of
 * guest signals writes to (log_signal_run, kind 'message', stage 'classify' —
 * the panel's line reads it through signal_run_status()).
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import type { ActiveConversation, StoredProvider } from "./adapter.ts";
import { fail, readNames } from "./db.ts";
import type { ApplyInput, ClaimedConversation, ConversationStay, MessageState, MessageStore } from "./message-run.ts";
import { MESSAGE_THEMES_DETECTOR } from "./message-read.ts";
import type { RunError } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

/** guest_message_state's answer, or null for no row; anything else reads as off. */
export function toMessageState(data: unknown): MessageState | null {
  if (!isRecord(data)) {
    return null;
  }
  return {
    enabled: data.enabled === true,
    daily_cap: number(data.daily_cap),
    daily_budget: number(data.daily_budget),
    month_budget: number(data.month_budget),
    min_confidence: number(data.min_confidence),
    calls_today: number(data.calls_today),
    spent_today: number(data.spent_today),
    spent_month: number(data.spent_month),
    poll_due: data.poll_due === true,
  };
}

export function createMessageStore(
  client: SupabaseClient,
  hostId: string,
  provider: StoredProvider,
): MessageStore {
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await client.rpc(fn, args);
    if (error) fail(fn, error);
    return data;
  };

  return {
    async state() {
      return toMessageState(await rpc("guest_message_state", { p_provider: provider, p_host_id: hostId }));
    },

    async collect() {
      return number(await rpc("collect_guest_message_events", { p_provider: provider, p_host_id: hostId }));
    },

    async queuePolled(rows: readonly ActiveConversation[]) {
      const data = await rpc("queue_polled_conversations", {
        p_provider: provider,
        p_rows: rows
          .filter((row) => row.externalListingId !== null)
          .map((row) => ({
            external_conversation_id: row.externalConversationId,
            external_listing_id: row.externalListingId,
            external_reservation_id: row.externalReservationId,
            last_guest_at: row.lastGuestAt.toISOString(),
          })),
        p_host_id: hostId,
      });
      const out = isRecord(data) ? data : {};
      return { queued: number(out.queued), missed: number(out.missed) };
    },

    async claim(limit: number) {
      const data = await rpc("claim_guest_conversations", {
        p_provider: provider,
        p_limit: limit,
        p_host_id: hostId,
      });
      return (Array.isArray(data) ? data : []) as ClaimedConversation[];
    },

    async stay(listing: string, unit: string | null, reservation: string | null) {
      const data = await rpc("guest_conversation_stay", {
        p_provider: provider,
        p_listing: listing,
        p_unit: unit,
        p_reservation: reservation,
        p_host_id: hostId,
      });
      return isRecord(data) ? (data as unknown as ConversationStay) : null;
    },

    async reserve(worstMicroUsd: number) {
      const data = await rpc("reserve_guest_message_reading", {
        p_provider: provider,
        p_detector: MESSAGE_THEMES_DETECTOR,
        p_worst_micro_usd: worstMicroUsd,
        p_host_id: hostId,
      });
      const out = isRecord(data) ? data : {};
      return out.granted === true
        ? { granted: true as const, runId: number(out.run_id) }
        : { granted: false as const, reason: typeof out.reason === "string" ? out.reason : "refused" };
    },

    async apply(input: ApplyInput) {
      const data = await rpc("apply_guest_message_reading", {
        p_provider: provider,
        p_conversation: input.conversation,
        p_messages: input.messages,
        p_labels: input.labels,
        p_detector: MESSAGE_THEMES_DETECTOR,
        p_read_to: input.readTo.toISOString(),
        p_run_id: input.runId,
        p_spent_micro_usd: input.spentMicroUsd,
        p_counts: input.counts,
        p_host_id: hostId,
      });
      return (isRecord(data) ? data : {}) as Record<string, number>;
    },

    async failRun(runId: number, spent: number | null, counts: Readonly<Record<string, number>>, errors: readonly RunError[]) {
      await rpc("fail_guest_message_reading", {
        p_run_id: runId,
        p_spent_micro_usd: spent,
        p_counts: counts,
        p_errors: errors,
      });
    },

    async finish(conversationId: string, readTo: Date | null, error: string | null) {
      await rpc("finish_guest_conversation", {
        p_provider: provider,
        p_conversation_id: conversationId,
        p_read_to: readTo === null ? null : readTo.toISOString(),
        p_error: error,
        p_host_id: hostId,
      });
    },

    redactionNames: () => readNames(client, hostId),

    async log(isOk: boolean, counts: Readonly<Record<string, number>>, errors: readonly RunError[]) {
      await rpc("log_signal_run", {
        p_provider: provider,
        p_kind: "message",
        p_stage: "classify",
        p_is_ok: isOk,
        p_counts: counts,
        p_errors: errors,
        p_host_id: hostId,
      });
    },
  };
}
