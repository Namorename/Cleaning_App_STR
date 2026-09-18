'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useSupabase } from '@/lib/supabase/use-client';

import {
  fetchCurrentUserId,
  fetchMessages,
  fetchUnreadThreads,
  markThreadRead,
  openThread,
  sendMessage,
} from './api';
import { chatKeys } from './keys';
import {
  NO_UNREAD,
  subjectKey,
  unreadSubjects,
  type ChatSubject,
  type UnreadSubjects,
} from './schema';

/**
 * How often an open thread asks for news. There is no Realtime on purpose
 * (docs/chat-plan.md): the poll runs only while the thread is on screen and
 * the tab is in front, which is what TanStack does by default.
 */
const MESSAGES_POLL_MS = 15_000;

/**
 * How often the marks and the count in the menu ask again while the tab is in
 * front. Slower than an open thread: a mark can wait a minute, and the answer
 * is one cheap call for the whole company.
 */
const UNREAD_POLL_MS = 60_000;

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

/** Reading a thread takes its mark off the card and one off the count. */
export function useMarkThreadRead() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, upTo }: { threadId: string; upTo: string }) =>
      markThreadRead(client, threadId, upTo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.unread() }),
  });
}

/** Every thread of the company with something unread; polled while the tab is in front. */
export function useUnreadThreads() {
  const client = useSupabase();
  return useQuery({
    queryKey: chatKeys.unread(),
    queryFn: () => fetchUnreadThreads(client),
    refetchInterval: UNREAD_POLL_MS,
  });
}

/**
 * The same answer as sets of subject ids, for a card to look itself up in.
 * Empty until the first answer: a mark that is not there yet is better than a
 * mark that is wrong.
 */
export function useUnreadSubjects(): UnreadSubjects {
  const { data } = useUnreadThreads();
  return useMemo(() => (data === undefined ? NO_UNREAD : unreadSubjects(data)), [data]);
}
