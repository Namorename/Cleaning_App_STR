import type { User } from '@supabase/supabase-js';

/**
 * The role a signed-in person carries, or null when the token has none.
 *
 * `app_metadata` is written by the server only (manage-staff); `user_metadata`
 * is filled by the client and must never decide what she is shown. The same
 * rule as the panel's `roleOf` (apps/web/src/lib/session.ts).
 *
 * What the role changes on the phone is only what is offered; what she may
 * read or do is decided by RLS on the server.
 */
export function roleOf(user: Pick<User, 'app_metadata'> | null): string | null {
  const role = user?.app_metadata?.role;
  return typeof role === 'string' ? role : null;
}
