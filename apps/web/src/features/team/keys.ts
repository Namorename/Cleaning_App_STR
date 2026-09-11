/** Query keys for everything the team section reads. */
export const teamKeys = {
  all: ['team'] as const,
  staff: () => ['team', 'staff'] as const,
  properties: () => ['team', 'properties'] as const,
  links: () => ['team', 'links'] as const,
};
