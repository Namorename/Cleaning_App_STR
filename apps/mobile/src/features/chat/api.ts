import { supabase } from '@/lib/supabase';

import {
  chatMessageListSchema,
  chatMessageSchema,
  chatThreadSchema,
  type ChatMessage,
  type ChatSubject,
  type ChatThread,
} from './schema';

/** The RPC arguments that name a subject; exactly one of them is set. */
function subjectArgs(subject: ChatSubject): { p_task_id?: string; p_problem_id?: string } {
  return subject.kind === 'task' ? { p_task_id: subject.id } : { p_problem_id: subject.id };
}

/**
 * Find or open the thread of a subject. The server answers "not found" for
 * a subject the caller may not read, and with the same row on every call.
 */
export async function openThread(subject: ChatSubject): Promise<ChatThread> {
  const { data, error } = await supabase.rpc('open_thread', subjectArgs(subject));
  if (error) {
    throw error;
  }
  return chatThreadSchema.parse(data);
}

const MESSAGE_COLUMNS =
  'id, thread_id, author_id, author_name, author_role, body, media_expected, created_at';

/** Every message of a thread, oldest first. Row level security draws the line. */
export async function fetchMessages(threadId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
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
  /** Made on the phone, so a retry after a lost connection is a replay, not a duplicate. */
  messageId: string;
  body: string;
  subject: ChatSubject;
}

/** Say something. Replayable by id: the server hands the same row back. */
export async function sendMessage(variables: SendMessageVariables): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('send_message', {
    p_id: variables.messageId,
    p_body: variables.body,
    ...subjectArgs(variables.subject),
  });
  if (error) {
    throw error;
  }
  return chatMessageSchema.parse(data);
}

export interface MarkReadVariables {
  threadId: string;
  /** The newest message actually drawn; the marker never walks backwards. */
  upTo: string;
}

export async function markThreadRead(variables: MarkReadVariables): Promise<void> {
  const { error } = await supabase.rpc('mark_thread_read', {
    p_thread_id: variables.threadId,
    p_up_to: variables.upTo,
  });
  if (error) {
    throw error;
  }
}
