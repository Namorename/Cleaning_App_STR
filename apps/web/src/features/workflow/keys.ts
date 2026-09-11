import type { WorkflowScope } from './schema';

/** Query keys for the process editor. */
export const workflowKeys = {
  all: ['workflow'] as const,
  process: (scope: WorkflowScope, propertyId: number | null) =>
    ['workflow', 'process', scope, propertyId] as const,
};
