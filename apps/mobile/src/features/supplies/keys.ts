export const supplyKeys = {
  all: ['supplies'] as const,
  mine: () => ['supplies', 'mine'] as const,
  one: (requestId: string) => ['supplies', 'one', requestId] as const,
};

/** Keys under which the writes are queued and replayed after a restart. */
export const supplyMutationKeys = {
  save: ['supplies', 'save'] as const,
  delete: ['supplies', 'delete'] as const,
};
