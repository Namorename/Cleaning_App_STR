/** Query keys for what the settings screen reads. */
export const settingsKeys = {
  all: ['settings'] as const,
  host: () => ['settings', 'host'] as const,
};
