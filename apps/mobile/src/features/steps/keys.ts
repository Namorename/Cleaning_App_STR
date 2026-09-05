/**
 * Query keys for a task's steps.
 *
 * In a file of their own so that the task hooks can invalidate the steps
 * (starting a task is what creates them) without importing the step hooks,
 * which import the task keys — a cycle otherwise.
 */
export const stepKeys = {
  all: ['steps'] as const,
  byTask: (taskId: string) => ['steps', taskId] as const,
};
