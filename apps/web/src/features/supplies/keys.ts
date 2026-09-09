/** Query keys for the supplies section. */
export const supplyKeys = {
  all: ['supplies'] as const,
  list: () => ['supplies', 'list'] as const,
};
