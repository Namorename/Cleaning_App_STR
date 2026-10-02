/**
 * Cache keys for the signed-in person's own settings.
 *
 * The user id is part of the key for the reason `profile/keys.ts` gives: the
 * cache is written to disk and outlives a sign-out, so a key without it would
 * show the next cleaner on a shared phone the switches of the one before her.
 */
export const settingsKeys = {
  all: ['settings'] as const,
  push: (userId: string) => ['settings', userId, 'push'] as const,
};

/**
 * The key a push choice is queued and replayed under after a restart. Its
 * function is registered by `registerSettingsMutations` before the cache is
 * restored; a paused write restored without one has nothing to run.
 */
export const settingsMutationKeys = {
  push: ['settings', 'push'] as const,
};
