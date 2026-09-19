import { z } from 'zod';

export const CHAT_SUBJECT_KINDS = ['task', 'problem'] as const;
export type ChatSubjectKind = (typeof CHAT_SUBJECT_KINDS)[number];

/** Mirrors `chat_body_max_length()` on the server; the server is what refuses. */
export const CHAT_BODY_MAX_LENGTH = 4000;

/** Mirrors `chat_max_photos()` on the server; the server is what refuses. */
export const CHAT_MAX_PHOTOS = 4;

/** Mirrors `chat_media_upload_window()`: how long a photo may wait for its file. */
export const CHAT_MEDIA_UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Has this message waited longer than a photo of it may wait for its file?
 *
 * Asked of the MESSAGE, not of the row, because the row cannot answer it. The
 * nightly sweep marks an abandoned row `purged_at` and the select drops it, so
 * a photo that never came leaves no trace at all — and until the sweep runs, up
 * to a day later, the row is still there saying nothing. Either way the
 * message's own age is what tells the reader the photo is not coming.
 *
 * `null` is a message this phone has just sent and the server has not
 * confirmed yet: nothing is late about it.
 */
export function isPastUploadWindow(createdAt: string | null, now = Date.now()): boolean {
  if (createdAt === null) {
    return false;
  }
  const sent = Date.parse(createdAt);
  return !Number.isNaN(sent) && now - sent > CHAT_MEDIA_UPLOAD_WINDOW_MS;
}

/**
 * A photo of a message, read together with the message. A row without
 * `uploaded_at` is a file still on its way (docs/chat-plan.md, layer 5): the
 * receiver draws it as a grey tile, the sender as her own upload. A row that
 * expired is never read: purged rows are filtered out at the select.
 */
export const chatMessageMediaSchema = z.object({
  id: z.string().uuid(),
  storage_path: z.string(),
  uploaded_at: z.string().nullable(),
  created_at: z.string(),
});
export type ChatMessageMedia = z.infer<typeof chatMessageMediaSchema>;

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
  /**
   * The photos the row was licensed for. Never what is drawn: how many photos
   * a message holds is said by its `task_media` rows and by nothing else.
   */
  media_expected: z.number().int(),
  created_at: z.string(),
  task_media: z.array(chatMessageMediaSchema).default([]),
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

/**
 * A thread with something the reader has not seen, as `chat_unread_threads`
 * returns it for the subjects on screen. The server decides; the phone only
 * draws the mark.
 */
export const chatUnreadThreadSchema = z.object({
  thread_id: z.string().uuid(),
  kind: z.enum(['task', 'problem', 'direct']),
  task_id: z.string().uuid().nullable(),
  problem_id: z.string().uuid().nullable(),
  last_message_at: z.string(),
});
export type ChatUnreadThread = z.infer<typeof chatUnreadThreadSchema>;
export const chatUnreadThreadListSchema = z.array(chatUnreadThreadSchema);

/** The subjects with unread threads, by kind, for a card to look itself up in. */
export interface UnreadSubjects {
  tasks: ReadonlySet<string>;
  problems: ReadonlySet<string>;
}

export const NO_UNREAD: UnreadSubjects = { tasks: new Set(), problems: new Set() };

export function unreadSubjects(threads: readonly ChatUnreadThread[]): UnreadSubjects {
  return {
    tasks: new Set(threads.flatMap((thread) => (thread.task_id === null ? [] : [thread.task_id]))),
    problems: new Set(
      threads.flatMap((thread) => (thread.problem_id === null ? [] : [thread.problem_id])),
    ),
  };
}
