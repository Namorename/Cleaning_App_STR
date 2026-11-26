/** Query keys of the manager boards. */
export const boardKeys = {
  all: ['boards'] as const,
  list: () => ['boards', 'list'] as const,
  cards: (boardId: string) => ['boards', 'cards', boardId] as const,
  card: (cardId: string) => ['boards', 'card', cardId] as const,
  /** A board's columns (20261126120000), the deleted ones too: the journal names them. */
  columns: (boardId: string) => ['boards', 'columns', boardId] as const,
  /** The columns of several boards at once («Назначено мне»): under `columns`, the ids in order. */
  columnsOf: (boardIds: readonly string[]) =>
    ['boards', 'columns', 'of', ...[...new Set(boardIds)].sort()] as const,
  /** «Назначено мне»: under `cards`, so every write that touches a board's cards touches it too. */
  mine: (viewerId: string) => ['boards', 'cards', 'mine', viewerId] as const,
  people: () => ['boards', 'people'] as const,
};
