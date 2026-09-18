export const chatKeys = {
  all: ['chat'] as const,
  /** The thread of a subject, by `subjectKey()`. */
  thread: (subject: string) => ['chat', 'thread', subject] as const,
  messages: (threadId: string) => ['chat', 'messages', threadId] as const,
};

/** Keys under which the writes are queued and replayed after a restart. */
export const chatMutationKeys = {
  send: ['chat', 'send'] as const,
  read: ['chat', 'read'] as const,
};
