import type { AppRole } from '@str-ops/shared';

import { knownRole, roleOf } from './role';
import { useSession } from './session';

/**
 * The signed-in person's role, from the session's token (`app_metadata`), or
 * null — nobody signed in, or a role this build does not know, which is shown
 * the cleaner's screens. It is known without a network: the token is on the
 * phone. Only what is offered follows it; RLS decides what is read.
 */
export function useRole(): AppRole | null {
  const { session } = useSession();
  return knownRole(roleOf(session?.user ?? null));
}
