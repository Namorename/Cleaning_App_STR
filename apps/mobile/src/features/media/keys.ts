export const mediaKeys = {
  all: ['media'] as const,
  byTask: (taskId: string) => ['media', 'task', taskId] as const,
  byProblem: (problemId: string) => ['media', 'problem', problemId] as const,
  byMessage: (messageId: string) => ['media', 'message', messageId] as const,
  urls: (paths: readonly string[]) => ['media', 'urls', ...paths] as const,
  local: ['media', 'local'] as const,
};
