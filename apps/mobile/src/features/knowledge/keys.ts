/** The knowledge base's reads (docs/knowledge-base-step2.md). */
export const knowledgeKeys = {
  all: ['knowledge'] as const,
  /** Every published article the reader may read, with its places and translations. */
  articles: () => ['knowledge', 'articles'] as const,
  /** One place, to know its house and its name. */
  place: (id: number) => ['knowledge', 'place', id] as const,
};
