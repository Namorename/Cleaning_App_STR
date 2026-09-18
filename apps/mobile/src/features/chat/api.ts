import { supabase } from '@/lib/supabase';

import {
  chatMessageListSchema,
  chatMessageSchema,
  chatThreadSchema,
  chatUnreadThreadListSchema,
  type ChatMessage,
  type ChatSubject,
  type ChatThread,
  type ChatUnreadThread,
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

/**
 * The photos come embedded: one round trip for the whole thread. Taken-back
 * and expired rows are filtered on the embed, not on the phone.
 */
const MESSAGE_COLUMNS =
  'id, thread_id, author_id, author_name, author_role, body, media_expected, created_at, ' +
  'task_media(id, storage_path, uploaded_at, created_at)';

/** Every message of a thread, oldest first. Row level security draws the line. */
export async function fetchMessages(threadId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(MESSAGE_COLUMNS)
    .eq('thread_id', threadId)
    .is('task_media.deleted_at', null)
    .is('task_media.purged_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .order('created_at', { referencedTable: 'task_media', ascending: true });
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
  /**
   * How many photos follow. The licence for a wordless message and the cap on
   * what may be registered under it; the server draws nothing from it.
   */
  mediaExpected?: number;
}

/** Say something. Replayable by id: the server hands the same row back. */
export async function sendMessage(variables: SendMessageVariables): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('send_message', {
    p_id: variables.messageId,
    p_body: variables.body,
    p_media_expected: variables.mediaExpected ?? 0,
    ...subjectArgs(variables.subject),
  });
  if (error) {
    throw error;
  }
  return chatMessageSchema.parse(data);
}

export interface UnreadQuery {
  taskIds: readonly string[];
  problemIds: readonly string[];
}

/**
 * Which of the subjects on screen have something unread. Always asked WITH
 * the ids: for field staff the server checks the audience rule per thread,
 * and a whole-company answer would cost more the bigger the company gets
 * (20260918160000_chat_unread.sql).
 */
export async function fetchUnreadThreads(query: UnreadQuery): Promise<ChatUnreadThread[]> {
  const { data, error } = await supabase.rpc('chat_unread_threads', {
    p_task_ids: [...query.taskIds],
    p_problem_ids: [...query.problemIds],
  });
  if (error) {
    throw error;
  }
  return chatUnreadThreadListSchema.parse(data ?? []);
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
