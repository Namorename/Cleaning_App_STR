export const mediaKeys = {
  all: ['media'] as const,
  byTask: (taskId: string) => ['media', 'task', taskId] as const,
  urls: (paths: readonly string[]) => ['media', 'urls', ...paths] as const,
  local: ['media', 'local'] as const,
};
