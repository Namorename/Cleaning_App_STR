import { z } from 'zod';

export const CHAT_THREAD_KINDS = ['task', 'problem', 'direct'] as const;
export type ChatThreadKind = (typeof CHAT_THREAD_KINDS)[number];

/**
 * Mirrors `chat_body_max_length()` on the server. The textarea stops at it so
 * the manager is not told "too long" after typing; the server is what refuses.
 */
export const CHAT_BODY_MAX_LENGTH = 4000;

/** A thread as `open_thread` returns it: the row and its denormalised tail. */
export const chatThreadSchema = z.object({
  id: z.uuid(),
  host_id: z.uuid(),
  kind: z.enum(CHAT_THREAD_KINDS),
  task_id: z.uuid().nullable(),
  problem_id: z.uuid().nullable(),
  profile_id: z.uuid().nullable(),
  created_at: z.string(),
  last_message_at: z.string().nullable(),
  last_author_id: z.uuid().nullable(),
  message_count: z.number(),
});
export type ChatThread = z.infer<typeof chatThreadSchema>;

/**
 * A message as the panel reads it. The author's name and role are on the
 * row itself, as they were when it was written, so a renamed or dismissed
 * colleague still signs what she said.
 */
export const chatMessageSchema = z.object({
  id: z.uuid(),
  thread_id: z.uuid(),
  author_id: z.uuid().nullable(),
  author_name: z.string().nullable(),
  author_role: z.string(),
  body: z.string(),
  media_expected: z.number(),
  created_at: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatMessageListSchema = z.array(chatMessageSchema);

/**
 * What a conversation is about. The company inbox (`direct`) is layer 6 and
 * has no subject here yet. A maintenance task that fixes a problem is given
 * as a task all the same: the server swaps it for the problem's thread, and
 * that rule is written there and nowhere else.
 */
export type ChatSubject = { taskId: string } | { problemId: string };

/** A stable string for a subject, for query keys and React keys. */
export function subjectKey(subject: ChatSubject): string {
  return 'taskId' in subject ? `task:${subject.taskId}` : `problem:${subject.problemId}`;
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
