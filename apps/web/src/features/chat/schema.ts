import { z } from 'zod';

export const CHAT_THREAD_KINDS = ['task', 'problem', 'direct'] as const;
export type ChatThreadKind = (typeof CHAT_THREAD_KINDS)[number];

/**
 * Mirrors `chat_body_max_length()` on the server. The textarea stops at it so
 * the manager is not told "too long" after typing; the server is what refuses.
 */
export const CHAT_BODY_MAX_LENGTH = 4000;

/** Mirrors `chat_max_photos()` on the server; the server is what refuses. */
export const CHAT_MAX_PHOTOS = 4;

/**
 * Mirrors `task_media_extension()` for photos: the only two the bucket and the
 * server take. The file dialog is limited to them, and a file that gets past
 * it is refused here — before a message is sent that would then declare a
 * photo no file can ever fill.
 */
export const CHAT_PHOTO_MIME_TYPES = ['image/jpeg', 'image/webp'] as const;

/** Mirrors `task_media_max_bytes('photo')`; the server is what refuses. */
export const CHAT_PHOTO_MAX_BYTES = 20 * 1024 * 1024;

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
 * `null` is a message this panel has just sent and the server has not
 * confirmed yet: nothing is late about it.
 */
export function isPastUploadWindow(createdAt: string | null, now = Date.now()): boolean {
  if (createdAt === null) {
    return false;
  }
  const sent = Date.parse(createdAt);
  return !Number.isNaN(sent) && now - sent > CHAT_MEDIA_UPLOAD_WINDOW_MS;
}

/** Is this something the server would accept as a photo of a message? */
export function isAcceptedPhoto(file: { type: string; size: number }): boolean {
  return (
    (CHAT_PHOTO_MIME_TYPES as readonly string[]).includes(file.type.toLowerCase()) &&
    file.size > 0 &&
    file.size <= CHAT_PHOTO_MAX_BYTES
  );
}

/**
 * A photo of a message, read together with the message.
 *
 * A row without `uploaded_at` is a file still on its way (docs/chat-plan.md,
 * layer 5): the reader sees a grey tile, the sender her own upload. Rows taken
 * back or expired never arrive here — the select filters them on the embed, so
 * the panel never has to know they existed.
 */
export const chatMessageMediaSchema = z.object({
  id: z.uuid(),
  storage_path: z.string(),
  uploaded_at: z.string().nullable(),
  created_at: z.string(),
});
export type ChatMessageMedia = z.infer<typeof chatMessageMediaSchema>;

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
  /**
   * The photos the row was licensed for. Never what is drawn: how many photos
   * a message holds is said by its `task_media` rows and by nothing else.
   */
  media_expected: z.number(),
  created_at: z.string(),
  task_media: z.array(chatMessageMediaSchema).default([]),
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

/**
 * A thread with something the reader has not seen, as `chat_unread_threads`
 * returns it: the tail is newer than the reader's marker and the last word
 * was somebody else's. The server decides; the panel only draws the mark.
 */
export const chatUnreadThreadSchema = z.object({
  thread_id: z.uuid(),
  kind: z.enum(CHAT_THREAD_KINDS),
  task_id: z.uuid().nullable(),
  problem_id: z.uuid().nullable(),
  profile_id: z.uuid().nullable(),
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
