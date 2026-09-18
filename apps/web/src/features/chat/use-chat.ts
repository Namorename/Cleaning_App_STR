'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { signedUrlsByPath } from '@/lib/media';
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
import { attachMessagePhoto, removeMessagePhoto, type AttachPhotoVariables } from './media';
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

/**
 * How long a batch of signed links is reused. Well under the hour storage
 * grants them, and well over the poll of an open thread, which would otherwise
 * re-sign every photo four times a minute.
 */
const PHOTO_URL_STALE_MS = 30 * 60_000;

/** Nothing signed yet. One frozen instance, so a render is not a new map. */
const NO_PHOTO_URLS: ReadonlyMap<string, string> = new Map();

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
  /** How many photos the composer is about to attach under this id. */
  mediaExpected?: number;
}

/** After a send the thread and its tail are stale together. */
export function useSendMessage(subject: ChatSubject) {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body, mediaExpected }: SendVariables) =>
      sendMessage(client, { id, body, mediaExpected, subject }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

/**
 * One photo, all the way: registered, uploaded, confirmed.
 *
 * Not folded into the send. The message is one idempotent call and each photo
 * is another, so a photo that fails leaves the words said and its row behind
 * as the hole the reader sees — rather than taking the message down with it.
 */
export function useAttachPhoto() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: AttachPhotoVariables) => attachMessagePhoto(client, variables),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

/** Take a photo back; the transcript is re-read afterwards. */
export function useRemovePhoto() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: string) => removeMessagePhoto(client, mediaId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

/**
 * Links for the photos on screen, asked for in one call and kept a little
 * under their own lifetime, so a poll of the transcript does not re-sign
 * everything every fifteen seconds.
 */
export function usePhotoUrls(paths: readonly string[]): ReadonlyMap<string, string> {
  const client = useSupabase();
  const { data } = useQuery({
    queryKey: chatKeys.photoUrls(paths),
    queryFn: () => signedUrlsByPath(client, paths),
    enabled: paths.length > 0,
    staleTime: PHOTO_URL_STALE_MS,
  });
  return data ?? NO_PHOTO_URLS;
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
