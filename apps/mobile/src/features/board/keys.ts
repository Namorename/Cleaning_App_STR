/**
 * The board's keys sit under `problems`, so whatever refreshes the tasks
 * (`problemKeys.all`) refreshes the board too. Keyed by the person: a phone
 * handed from one head technician to another starts from nothing of his.
 */
export const boardKeys = {
  list: (userId: string) => ['problems', 'board', userId] as const,
  one: (userId: string, problemId: string) => ['problems', 'board', userId, problemId] as const,
  /** The archive's pages, read on demand (`fetchArchivePage`). */
  archive: (userId: string) => ['problems', 'board', userId, 'archive'] as const,
  staff: (userId: string) => ['staff', 'directory', userId] as const,
  /** The head technician's two moves, «Назначить» and «Снять»: one key, so either blocks both. */
  dispatch: ['board', 'dispatch'] as const,
};
