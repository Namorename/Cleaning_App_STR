/** Query keys for everything the chat reads. */
export const chatKeys = {
  all: ['chat'] as const,
  /** The thread of a subject, by `subjectKey()`. */
  thread: (subject: string) => ['chat', 'thread', subject] as const,
  messages: (threadId: string) => ['chat', 'messages', threadId] as const,
  /** Links to the photos of a thread, by the paths they were asked for. */
  photoUrls: (paths: readonly string[]) => ['chat', 'photo-urls', [...paths].sort()] as const,
  currentUser: () => ['chat', 'current-user'] as const,
  /** Every thread with something unread, for the marks on cards and the count in the menu. */
  unread: () => ['chat', 'unread'] as const,
};
