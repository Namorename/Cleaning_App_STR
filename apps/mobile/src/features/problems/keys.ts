export const problemKeys = {
  all: ['problems'] as const,
  mine: () => ['problems', 'mine'] as const,
  one: (problemId: string) => ['problems', 'one', problemId] as const,
};

/** Keys under which the two writes are queued and replayed after a restart. */
export const problemMutationKeys = {
  report: ['problems', 'report'] as const,
  update: ['problems', 'update'] as const,
};
