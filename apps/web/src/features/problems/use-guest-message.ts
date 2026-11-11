'use client';

import {
  GUEST_MESSAGE_FUNCTION,
  guestMessageBody,
  readGuestMessages,
  type Database,
  type GuestMessage,
  type GuestMessageAsk,
} from '@str-ops/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';

import { functionError, ServerRefusal } from '@/lib/function-error';
import { useSupabase } from '@/lib/supabase/use-client';

type Client = SupabaseClient<Database>;

/**
 * The guest's message of a chat task or card as Hostaway has it now (guest-message-text,
 * docs/guest-message-text.md): read on the reader's word, never stored — the page holds it in
 * memory only. A refusal comes back as a ServerRefusal whose hint names the state to show.
 */
export async function fetchGuestMessage(
  client: Client,
  ask: GuestMessageAsk,
): Promise<readonly GuestMessage[]> {
  const { data, error } = await client.functions.invoke(GUEST_MESSAGE_FUNCTION, {
    body: guestMessageBody(ask),
  });
  if (error) {
    throw await functionError(error);
  }
  const messages = readGuestMessages((data as { data?: unknown } | null)?.data);
  if (messages === null) {
    throw new ServerRefusal('The function answered without a message');
  }
  return messages;
}

/** How long the page keeps what it read: as the function's own memory, three minutes. */
const GUEST_MESSAGE_KEEP_MS = 3 * 60 * 1000;

export const guestMessageKey = (ask: GuestMessageAsk) =>
  'problemId' in ask
    ? (['guest-message-text', 'task', ask.problemId] as const)
    : (['guest-message-text', 'card', ask.findingId] as const);

/**
 * Asked once on the reader's word (`enabled`), held in this page's memory only — never persisted,
 * never retried by itself (each read counts against the limit) and gone three minutes after the
 * block leaves the screen.
 */
export function useGuestMessage(ask: GuestMessageAsk, enabled: boolean) {
  const client = useSupabase();
  return useQuery({
    queryKey: guestMessageKey(ask),
    queryFn: () => fetchGuestMessage(client, ask),
    enabled,
    staleTime: Infinity,
    gcTime: GUEST_MESSAGE_KEEP_MS,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
