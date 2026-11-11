/** Query keys for everything the problems section reads. */
export const problemKeys = {
  all: ['problems'] as const,
  list: () => ['problems', 'list'] as const,
  detail: (problemId: string) => ['problems', 'detail', problemId] as const,
  photos: (problemId: string) => ['problems', 'photos', problemId] as const,
  theme: (problemId: string) => ['problems', 'theme', problemId] as const,
  /** Where a task from a guest came from (problem_guest_origin): read when the page asks. */
  origin: (problemId: string) => ['problems', 'origin', problemId] as const,
  fixSteps: (taskId: string) => ['problems', 'fix-steps', taskId] as const,
  staff: () => ['problems', 'staff'] as const,
  workers: () => ['problems', 'workers'] as const,
};
