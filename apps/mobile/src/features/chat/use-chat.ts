import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { useMemo } from 'react';

import { useSession } from '@/features/auth/session';
import { readCached } from '@/lib/read-cached';

import {
  fetchMessages,
  fetchUnreadThreads,
  markThreadRead,
  openThread,
  sendMessage,
  type MarkReadVariables,
  type SendMessageVariables,
} from './api';
import { chatKeys, chatMutationKeys } from './keys';
import {
  NO_UNREAD,
  chatMessageListSchema,
  subjectKey,
  unreadSubjects,
  type ChatMessage,
  type ChatSubject,
  type PendingMessage,
  type UnreadSubjects,
} from './schema';

/**
 * Messages go out one after another, in the order they were written. Their
 * own scope, apart from photos: a text must not queue behind somebody's
 * twenty-megabyte video in the media queue.
 */
const SEND_SCOPE = { id: 'chat-send' };
const SEND_RETRIES = 3;

/**
 * How often an open thread asks for news. No Realtime, on purpose
 * (docs/chat-plan.md): a subscription per phone in the field costs a
 * connection around the clock for a few messages a day. The poll runs only
 * while the thread is on screen and the app is in front.
 */
const MESSAGES_POLL_MS = 10_000;

/** Teach the query client how to replay each write after a restart. */
export function registerChatMutations(queryClient: QueryClient): void {
  queryClient.setMutationDefaults(chatMutationKeys.send, {
    mutationFn: (variables: SendMessageVariables) => sendMessage(variables),
    scope: SEND_SCOPE,
    retry: SEND_RETRIES,
  });
  queryClient.setMutationDefaults(chatMutationKeys.read, {
    mutationFn: (variables: MarkReadVariables) => markThreadRead(variables),
  });
}

export function useThread(subject: ChatSubject | null) {
  const { userId } = useSession();

  return useQuery({
    queryKey: chatKeys.thread(subject === null ? '' : subjectKey(subject)),
    queryFn: () => openThread(subject as ChatSubject),
    enabled: userId !== null && subject !== null,
  });
}

/**
 * The cache on disk is restored by JSON.parse, so a thread saved by an older
 * build comes back in the shape that build read: the OTA that added photos
 * found threads without `task_media` and the chat screen closed the app.
 * Read like any outside input, the old shape gains what it lacks, and a shape
 * that cannot be read becomes a short query error the screen shows.
 * Module-level so the query runs it only when the data changes.
 */
function readMessages(data: unknown): ChatMessage[] {
  return readCached(chatMessageListSchema, data, 'chat messages');
}

/**
 * The messages of a thread. `isLive` says whether the thread is on screen:
 * only then does it poll.
 */
export function useMessages(threadId: string | null, isLive: boolean) {
  const { userId } = useSession();

  return useQuery({
    queryKey: chatKeys.messages(threadId ?? ''),
    queryFn: () => fetchMessages(threadId ?? ''),
    select: readMessages,
    enabled: userId !== null && threadId !== null,
    refetchInterval: isLive ? MESSAGES_POLL_MS : false,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation<ChatMessage, Error, SendMessageVariables>({
    mutationKey: chatMutationKeys.send,
    mutationFn: sendMessage,
    scope: SEND_SCOPE,
    retry: SEND_RETRIES,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.all });
    },
  });
}

/**
 * What this phone has said and the server has not yet confirmed, including
 * messages paused on disk for lack of signal. Drawn under the transcript so
 * the sender sees her words the moment she taps, not when the stairwell
 * finds signal.
 */
export function usePendingMessages(subject: ChatSubject | null): PendingMessage[] {
  const key = subject === null ? null : subjectKey(subject);

  return useMutationState({
    filters: { mutationKey: chatMutationKeys.send, status: 'pending' },
    select: (mutation) => {
      const variables = mutation.state.variables as SendMessageVariables | undefined;
      if (variables === undefined || key === null || subjectKey(variables.subject) !== key) {
        return null;
      }
      return { id: variables.messageId, body: variables.body };
    },
  }).filter((item): item is PendingMessage => item !== null);
}

/** Reading a thread takes its mark off the card. */
export function useMarkThreadRead() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, MarkReadVariables>({
    mutationKey: chatMutationKeys.read,
    mutationFn: markThreadRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.unreadAll });
    },
  });
}

/**
 * Which of the subjects on a screen have something unread. Asked with the ids
 * on screen, never for the whole company (docs/chat-plan.md, layer 4). It
 * refreshes when the app comes back to the front, on pull-to-refresh through
 * `refetch`, and after this phone's own send or read; there is no poll.
 * Empty until the first answer: a mark that is not there yet is better than a
 * mark that is wrong.
 */
export function useUnreadSubjects(
  taskIds: readonly string[],
  problemIds: readonly string[],
): UnreadSubjects & { refetch: () => void } {
  const { userId } = useSession();
  const { data, refetch } = useQuery({
    queryKey: chatKeys.unread(taskIds, problemIds),
    queryFn: () => fetchUnreadThreads({ taskIds, problemIds }),
    enabled: userId !== null && taskIds.length + problemIds.length > 0,
  });

  return useMemo(
    () => ({
      ...(data === undefined ? NO_UNREAD : unreadSubjects(data)),
      refetch: () => {
        void refetch();
      },
    }),
    [data, refetch],
  );
}
