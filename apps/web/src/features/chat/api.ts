import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import {
  chatMessageListSchema,
  chatMessageSchema,
  chatThreadSchema,
  type ChatMessage,
  type ChatSubject,
  type ChatThread,
} from './schema';

export type Client = SupabaseClient<Database>;

/** The RPC arguments that name a subject; exactly one of them is set. */
function subjectArgs(subject: ChatSubject): {
  p_task_id?: string;
  p_problem_id?: string;
} {
  return 'taskId' in subject ? { p_task_id: subject.taskId } : { p_problem_id: subject.problemId };
}

/**
 * Find or open the thread of a subject. The server answers "not found" for
 * a subject the caller may not read, and with the same row on every call.
 */
export async function openThread(client: Client, subject: ChatSubject): Promise<ChatThread> {
  const { data, error } = await client.rpc('open_thread', subjectArgs(subject));
  if (error) {
    throw error;
  }
  return chatThreadSchema.parse(data);
}

const MESSAGE_COLUMNS =
  'id, thread_id, author_id, author_name, author_role, body, media_expected, created_at';

/** Every message of a thread, oldest first. Row level security draws the line. */
export async function fetchMessages(client: Client, threadId: string): Promise<ChatMessage[]> {
  const { data, error } = await client
    .from('chat_messages')
    .select(MESSAGE_COLUMNS)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw error;
  }
  return chatMessageListSchema.parse(data ?? []);
}

export interface SendMessageVariables {
  /** Minted by the panel when the draft starts, so a retry replays instead of duplicating. */
  id: string;
  body: string;
  subject: ChatSubject;
}

export async function sendMessage(
  client: Client,
  variables: SendMessageVariables,
): Promise<ChatMessage> {
  const { data, error } = await client.rpc('send_message', {
    p_id: variables.id,
    p_body: variables.body,
    ...subjectArgs(variables.subject),
  });
  if (error) {
    throw error;
  }
  return chatMessageSchema.parse(data);
}

/**
 * Move the reader's marker up to the newest message actually drawn. The
 * server never moves it backwards, so a late replay is harmless.
 */
export async function markThreadRead(
  client: Client,
  threadId: string,
  upTo: string,
): Promise<void> {
  const { error } = await client.rpc('mark_thread_read', {
    p_thread_id: threadId,
    p_up_to: upTo,
  });
  if (error) {
    throw error;
  }
}

/** Who is signed in, to tell own messages from the others. Null when nobody is. */
export async function fetchCurrentUserId(client: Client): Promise<string | null> {
  const { data, error } = await client.auth.getUser();
  if (error) {
    throw error;
  }
  return data.user?.id ?? null;
}
