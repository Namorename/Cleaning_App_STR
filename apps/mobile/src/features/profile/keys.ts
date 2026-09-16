/**
 * Cache keys for the signed-in person's own row.
 *
 * The user id is part of the key on purpose. This cache is written to disk and
 * is not cleared on sign-out, so a key without it would hand the next cleaner
 * on a shared phone the language of the one before her.
 */
export const profileKeys = {
  all: ['profile'] as const,
  language: (userId: string) => ['profile', userId, 'language'] as const,
};
