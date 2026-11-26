/** Query keys for everything the problems section reads. */
export const problemKeys = {
  all: ['problems'] as const,
  list: () => ['problems', 'list'] as const,
  detail: (problemId: string) => ['problems', 'detail', problemId] as const,
  photos: (problemId: string) => ['problems', 'photos', problemId] as const,
  /** What the office added to the task (20261126100000). */
  additions: (problemId: string) => ['problems', 'additions', problemId] as const,
  theme: (problemId: string) => ['problems', 'theme', problemId] as const,
  /** Where a task from a guest came from (problem_guest_origin): read when the page asks. */
  origin: (problemId: string) => ['problems', 'origin', problemId] as const,
  fixSteps: (taskId: string) => ['problems', 'fix-steps', taskId] as const,
  staff: () => ['problems', 'staff'] as const,
  workers: () => ['problems', 'workers'] as const,
};

/**
 * How the company names a task, and its catalogue (catalog.ts): apart from `problemKeys.all`, so
 * a task written does not read the catalogue again.
 */
export const problemCatalogKeys = {
  all: ['problem-catalog'] as const,
};
