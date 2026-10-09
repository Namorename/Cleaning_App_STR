import { Constants, type AppRole } from '@str-ops/shared';
import type { User } from '@supabase/supabase-js';

import type { WordContext } from '@/i18n';

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

/** Every role this build knows, read off the database enum. */
const ROLES: readonly string[] = Constants.public.Enums.app_role;

function isRole(value: string): value is AppRole {
  return ROLES.includes(value);
}

/**
 * The role as one this build knows, or null. A value a newer server invented
 * is no role at all, and no role is shown the cleaner's screens — the view
 * every one of her tests covers — while the server still decides what it reads.
 */
export function knownRole(role: string | null): AppRole | null {
  return role !== null && isRole(role) ? role : null;
}

/** The roles that have nothing to do with cleanings (docs/tech-plan.md §0, §2, §3). */
const TECHNICIANS: ReadonlySet<AppRole> = new Set(['tech', 'head_tech']);

/**
 * The technician and the head technician: no cleanings, no free queue, no
 * supplies — their tabs, pushes and words are a technician's.
 */
export function isTechnician(role: AppRole | null): boolean {
  return role !== null && TECHNICIANS.has(role);
}

/**
 * The i18next context of the words this role reads (tech-plan §6): both
 * technicians read the `_tech` variant of a key where there is one — «работа»
 * where a cleaner reads «уборка». Everybody else reads the key itself.
 */
export function wordContextOf(role: AppRole | null): WordContext | undefined {
  return isTechnician(role) ? 'tech' : undefined;
}
