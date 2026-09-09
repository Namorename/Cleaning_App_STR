/** Query keys for everything the problems section reads. */
export const problemKeys = {
  all: ['problems'] as const,
  list: () => ['problems', 'list'] as const,
  detail: (problemId: string) => ['problems', 'detail', problemId] as const,
  photos: (problemId: string) => ['problems', 'photos', problemId] as const,
  fixSteps: (taskId: string) => ['problems', 'fix-steps', taskId] as const,
  staff: () => ['problems', 'staff'] as const,
};
