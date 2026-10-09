import { goOffline, isNetworkError } from '@/lib/online';

/**
 * How a field action tries again: a cleaning taken, accepted, started or
 * finished, a step done or skipped with what she typed, a supply request, a
 * report, a message.
 *
 * A failure that is the network's never ends the action. It marks the client
 * offline (lib/online.ts); the action pauses on disk until a look finds the
 * server, and goes through then with nothing tapped twice — every one of them
 * is an idempotent call with an id the phone made (CLAUDE.md). That holds
 * however many failures came before: TanStack hands `retry` only the count of
 * all of them, outages included, so any limit on that count would end the
 * action after a stairwell or two — and an action that failed is not kept on
 * disk, its screen long gone, the cleaner never told (the verification review
 * of f3217a7..c466bf5). A server whose health answers while the action does
 * not is asked again at every look, one request every fifteen seconds; that
 * costs less than a lost «Готово».
 *
 * Anything else — a refusal, a server error — gets its few more tries and
 * then fails, so the screen can say why.
 *
 * Uploads are the exception and keep their own counts
 * (features/media/attach-retry.ts): an upload that fails keeps its file and
 * a «Повторить» tile, so it can be bounded without losing anything.
 */

/** One more try for a move the server refused or failed. */
export const MUTATION_RETRIES = 1;

/** TanStack's own wait before another try: twice as long each time, at most thirty seconds. */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

type ShouldRetry = (failureCount: number, error: unknown) => boolean;

/** A field action's `retry`, with `refusals` more tries for anything but the network. */
export function retryMoveAfter(refusals: number): ShouldRetry {
  return (failureCount, error) => {
    if (isNetworkError(error)) {
      goOffline();
      return true;
    }
    return failureCount < refusals;
  };
}

/** The app's moves: a network failure waits, a refusal gets one more try. */
export const retryMove: ShouldRetry = retryMoveAfter(MUTATION_RETRIES);

/** TanStack's own wait between tries, for what a refusal is owed and for uploads. */
export function backoffDelay(failureCount: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** failureCount, BACKOFF_MAX_MS);
}

/**
 * How long a move waits before its next try. After a network failure, not
 * at all: the client has just gone offline, so the move pauses at once — and
 * a paused move is what TanStack keeps on disk. Sleeping out a backoff
 * instead, it is on disk nowhere, and once the server's look comes back
 * sooner than the backoff ends it is sent again without ever pausing: closed
 * then, the phone would forget it. The next try waits for the look either
 * way.
 */
export function moveRetryDelay(failureCount: number, error: unknown): number {
  return isNetworkError(error) ? 0 : backoffDelay(failureCount);
}
