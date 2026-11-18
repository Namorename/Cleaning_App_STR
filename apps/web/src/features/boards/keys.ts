/** Query keys of the manager boards. */
export const boardKeys = {
  all: ['boards'] as const,
  list: () => ['boards', 'list'] as const,
  cards: (boardId: string) => ['boards', 'cards', boardId] as const,
  card: (cardId: string) => ['boards', 'card', cardId] as const,
  /** «Назначено мне»: under `cards`, so every write that touches a board's cards touches it too. */
  mine: (viewerId: string) => ['boards', 'cards', 'mine', viewerId] as const,
  people: () => ['boards', 'people'] as const,
};
