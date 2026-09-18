import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';

import {
  fetchMessages,
  markThreadRead,
  openThread,
  sendMessage,
  type MarkReadVariables,
  type SendMessageVariables,
} from './api';
import { chatKeys, chatMutationKeys } from './keys';
import { subjectKey, type ChatMessage, type ChatSubject, type PendingMessage } from './schema';

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
 * The messages of a thread. `isLive` says whether the thread is on screen:
 * only then does it poll.
 */
export function useMessages(threadId: string | null, isLive: boolean) {
  const { userId } = useSession();

  return useQuery({
    queryKey: chatKeys.messages(threadId ?? ''),
    queryFn: () => fetchMessages(threadId ?? ''),
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

export function useMarkThreadRead() {
  return useMutation<void, Error, MarkReadVariables>({
    mutationKey: chatMutationKeys.read,
    mutationFn: markThreadRead,
  });
}
