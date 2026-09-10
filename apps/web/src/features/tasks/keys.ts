/** Query keys for everything the tasks section reads. */
export const taskKeys = {
  all: ['tasks'] as const,
  list: () => ['tasks', 'list'] as const,
  steps: (taskId: string) => ['tasks', 'steps', taskId] as const,
  problems: (taskId: string) => ['tasks', 'problems', taskId] as const,
  staff: () => ['tasks', 'staff'] as const,
  properties: () => ['tasks', 'properties'] as const,
  companyLanguage: () => ['tasks', 'company-language'] as const,
};
