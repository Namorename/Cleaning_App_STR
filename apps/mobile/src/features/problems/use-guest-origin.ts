import type { GuestOrigin, GuestSource } from '@str-ops/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';

import { fetchGuestOrigin } from './api';
import { problemKeys } from './keys';

/**
 * Never on disk (lib/query-client.ts, `shouldSaveList`): the head technician's
 * answer carries the guest's name, and nothing on the phone keeps it. It is
 * read when the task's screen asks, held in memory, and gone with the cache —
 * at sign-out, or when the app is closed.
 */
export const GUEST_ORIGIN_META = { persist: false } as const;

/** One more try after a failure: a block beside the task, not worth a longer wait. */
const RETRIES = 1;

/**
 * The cloud has no such function yet: a phone with this update may ask before
 * migration 20261111120000 is applied. PostgREST says so as a function it
 * cannot find (PGRST202, a 404), Postgres as an undefined function (42883).
 */
const MISSING_CODES: ReadonlySet<string> = new Set(['PGRST202', '42883']);

export function isGuestOriginMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const { code } = error as { code: unknown };
  return typeof code === 'string' && MISSING_CODES.has(code);
}

/** A failed read is asked once more — unless the function is missing: asking again asks the same. */
export function retryGuestOrigin(failureCount: number, error: unknown): boolean {
  return !isGuestOriginMissing(error) && failureCount < RETRIES;
}

/**
 * Where a task from a guest came from, as the server tells this person
 * (`fetchGuestOrigin`). Asked only for a task a guest's review or chat made
 * (`source`); a report of the staff asks nothing.
 */
export function useGuestOrigin(
  problemId: string,
  source: GuestSource | null,
): UseQueryResult<GuestOrigin | null, Error> {
  const { userId } = useSession();

  return useQuery({
    queryKey: problemKeys.origin(userId ?? '', problemId),
    queryFn: () => fetchGuestOrigin(problemId),
    enabled: userId !== null && source !== null && problemId !== '',
    retry: (failureCount, error: Error) => retryGuestOrigin(failureCount, error),
    meta: GUEST_ORIGIN_META,
  });
}
