/** Query keys of the manager boards. */
export const boardKeys = {
  all: ['boards'] as const,
  list: () => ['boards', 'list'] as const,
  cards: (boardId: string) => ['boards', 'cards', boardId] as const,
  card: (cardId: string) => ['boards', 'card', cardId] as const,
};
