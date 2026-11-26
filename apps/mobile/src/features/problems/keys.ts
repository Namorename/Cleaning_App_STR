export const problemKeys = {
  all: ['problems'] as const,
  mine: () => ['problems', 'mine'] as const,
  one: (problemId: string) => ['problems', 'one', problemId] as const,
  /** What the office added to the task (20261126100000); a closing reads it again with the rest. */
  additions: (problemId: string) => ['problems', 'additions', problemId] as const,
  /**
   * Where a task from a guest came from (`useGuestOrigin`). Keyed by the
   * person: what the server tells depends on who asks — the head technician
   * hears the guest's name, a technician never does.
   */
  origin: (userId: string, problemId: string) => ['problems', 'origin', userId, problemId] as const,
};

/**
 * The company's catalogue of categories (`useReportCatalog`). Apart from
 * `problemKeys.all` on purpose: every report invalidates the tasks, and the
 * catalogue does not change with them.
 */
export const problemCategoryKeys = {
  all: ['problem-categories'] as const,
};

/** Keys under which the two writes are queued and replayed after a restart. */
export const problemMutationKeys = {
  report: ['problems', 'report'] as const,
  update: ['problems', 'update'] as const,
};
