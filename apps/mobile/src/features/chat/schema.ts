import { z } from 'zod';

export const CHAT_SUBJECT_KINDS = ['task', 'problem'] as const;
export type ChatSubjectKind = (typeof CHAT_SUBJECT_KINDS)[number];

/** Mirrors `chat_body_max_length()` on the server; the server is what refuses. */
export const CHAT_BODY_MAX_LENGTH = 4000;

/** A thread as `open_thread` returns it. Only the id is used on the phone today. */
export const chatThreadSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['task', 'problem', 'direct']),
  task_id: z.string().uuid().nullable(),
  problem_id: z.string().uuid().nullable(),
  last_message_at: z.string().nullable(),
  message_count: z.number().int(),
});
export type ChatThread = z.infer<typeof chatThreadSchema>;

/**
 * A message as the phone reads it. The author's name and role travel on the
 * row: the phone cannot read anyone else's profile, and a colleague renamed
 * or dismissed since still signs what she said.
 */
export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  author_id: z.string().uuid().nullable(),
  author_name: z.string().nullable(),
  author_role: z.string(),
  body: z.string(),
  media_expected: z.number().int(),
  created_at: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatMessageListSchema = z.array(chatMessageSchema);

/**
 * What the conversation is about. A maintenance task is given as a task all
 * the same: the server swaps it for its problem's thread, and that rule is
 * written there and nowhere else.
 */
export interface ChatSubject {
  kind: ChatSubjectKind;
  id: string;
}

/** A stable string for a subject, for query keys. */
export function subjectKey(subject: ChatSubject): string {
  return `${subject.kind}:${subject.id}`;
}

/** The timestamp of the newest message drawn, or null for an empty thread. */
export function newestMessageAt(messages: readonly ChatMessage[]): string | null {
  return messages.reduce<string | null>(
    (newest, message) =>
      newest === null || message.created_at > newest ? message.created_at : newest,
    null,
  );
}

export function isOwnMessage(message: ChatMessage, userId: string | null): boolean {
  return userId !== null && message.author_id === userId;
}

/** A message this phone has sent and the server has not yet acknowledged. */
export interface PendingMessage {
  id: string;
  body: string;
}
