export const chatKeys = {
  all: ['chat'] as const,
  /** The thread of a subject, by `subjectKey()`. */
  thread: (subject: string) => ['chat', 'thread', subject] as const,
  messages: (threadId: string) => ['chat', 'messages', threadId] as const,
  /** Every unread answer, whatever the screen asked about. */
  unreadAll: ['chat', 'unread'] as const,
  /** The unread marks for one screen's subjects; the ids are sorted so the key is stable. */
  unread: (taskIds: readonly string[], problemIds: readonly string[]) =>
    ['chat', 'unread', [...taskIds].sort(), [...problemIds].sort()] as const,
};

/** Keys under which the writes are queued and replayed after a restart. */
export const chatMutationKeys = {
  send: ['chat', 'send'] as const,
  read: ['chat', 'read'] as const,
};
