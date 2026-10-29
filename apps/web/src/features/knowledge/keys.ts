/** Query keys for «База знаний». */
export const knowledgeKeys = {
  all: ['knowledge'] as const,
  list: () => ['knowledge', 'list'] as const,
  article: (id: string) => ['knowledge', 'article', id] as const,
  revisions: (id: string) => ['knowledge', 'revisions', id] as const,
  places: () => ['knowledge', 'places'] as const,
  people: () => ['knowledge', 'people'] as const,
};
