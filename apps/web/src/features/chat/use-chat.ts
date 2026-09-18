'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import { fetchCurrentUserId, fetchMessages, markThreadRead, openThread, sendMessage } from './api';
import { chatKeys } from './keys';
import { subjectKey, type ChatSubject } from './schema';

/**
 * How often an open thread asks for news. There is no Realtime on purpose
 * (docs/chat-plan.md): the poll runs only while the thread is on screen and
 * the tab is in front, which is what TanStack does by default.
 */
const MESSAGES_POLL_MS = 15_000;

export function useThread(subject: ChatSubject) {
  const client = useSupabase();
  return useQuery({
    queryKey: chatKeys.thread(subjectKey(subject)),
    queryFn: () => openThread(client, subject),
  });
}

/** The messages of a thread; idle until there is a thread to read. */
export function useMessages(threadId: string | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: chatKeys.messages(threadId ?? ''),
    queryFn: () => fetchMessages(client, threadId ?? ''),
    enabled: threadId !== null,
    refetchInterval: MESSAGES_POLL_MS,
  });
}

export function useCurrentUserId(): string | null {
  const client = useSupabase();
  const { data } = useQuery({
    queryKey: chatKeys.currentUser(),
    queryFn: () => fetchCurrentUserId(client),
    staleTime: Infinity,
  });
  return data ?? null;
}

export interface SendVariables {
  id: string;
  body: string;
}

/** After a send the thread and its tail are stale together. */
export function useSendMessage(subject: ChatSubject) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: SendVariables) => sendMessage(client, { id, body, subject }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useMarkThreadRead() {
  const client = useSupabase();
  return useMutation({
    mutationFn: ({ threadId, upTo }: { threadId: string; upTo: string }) =>
      markThreadRead(client, threadId, upTo),
  });
}
