import type { QueryClient } from '@tanstack/react-query';

import { noteSignedIn, setQueuePerson } from '@/lib/move-queue';

/** Whose moves the tests' queue holds when nothing says otherwise. */
export const QUEUE_PERSON = 'u1';

/**
 * The phone as the root layout leaves it once `userId` is signed in and the
 * queue sorted for them (features/auth/forget-on-sign-out.ts): the moves made
 * from now on are theirs, and theirs are the ones resumed. Without it nothing
 * is resumed — as on a phone whose session is not known yet.
 */
export function signedInWithQueue(client: QueryClient, userId: string = QUEUE_PERSON): void {
  noteSignedIn(userId);
  setQueuePerson(client, userId);
}

/** Nobody signed in: the state every test file starts from. */
export function signedOutOfQueue(): void {
  noteSignedIn(null);
}

/** The meta a move saved by this build carries: its author. */
export function authoredBy(userId: string = QUEUE_PERSON): { meta: { authorId: string } } {
  return { meta: { authorId: userId } };
}
