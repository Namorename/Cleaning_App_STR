import { hashKey, type MutationFunction } from '@tanstack/react-query';

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
 * then fails, so the screen can say why. Those tries are counted apart, by
 * the move (`countRefusals`): measured against TanStack's count, which holds
 * the outages too, the first real refusal after a stairwell or two got no
 * try at all (the verification review of c466bf5..bc7dcc9, item 3).
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

interface Refusal {
  /** The move it was: its key and what it sends (`hashKey`). */
  move: string;
  /** Which refusal of the move it was, from 1. */
  count: number;
}

/** How many times each move has been refused since it was handed to the queue. */
const refusalsByMove = new Map<string, number>();
/** Each counted failure, marked with its move and its number. */
const refusalMarks = new WeakMap<object, Refusal>();
/** The `retry` functions made here: only the moves they decide on are counted. */
const moveRetries = new WeakSet<object>();
/** The counting mutationFns made here, so none is wrapped twice. */
const countingFns = new WeakSet<object>();

function noteRefusal(move: string, error: unknown): void {
  if (isNetworkError(error) || typeof error !== 'object' || error === null) {
    return;
  }
  const count = (refusalsByMove.get(move) ?? 0) + 1;
  refusalsByMove.set(move, count);
  refusalMarks.set(error, { move, count });
}

function refusalOf(error: unknown): Refusal | undefined {
  return typeof error === 'object' && error !== null ? refusalMarks.get(error) : undefined;
}

/**
 * A move's call, counting its refusals: each failure that is not the
 * network's is marked with which refusal of this move it was, for `retry` to
 * read — TanStack hands `retry` only the failure and a count of all of them.
 * A move is its key and what it sends; the phone made the id in it, and a
 * move sent again with the same is the same move. Its count is let go once it
 * goes through, or once its refusals are spent and it fails: tapped again, it
 * starts afresh.
 */
export function countRefusals<TData, TVariables>(
  mutationFn: MutationFunction<TData, TVariables>,
): MutationFunction<TData, TVariables> {
  if (countingFns.has(mutationFn)) {
    return mutationFn;
  }
  const counting: MutationFunction<TData, TVariables> = async (variables, context) => {
    const move = hashKey([context.mutationKey ?? null, variables]);
    try {
      const data = await mutationFn(variables, context);
      refusalsByMove.delete(move);
      return data;
    } catch (error: unknown) {
      noteRefusal(move, error);
      throw error;
    }
  };
  countingFns.add(counting);
  return counting;
}

/** Whether `retry` is a field action's, made by `retryMoveAfter`. */
export function isMoveRetry(retry: unknown): boolean {
  return typeof retry === 'function' && moveRetries.has(retry);
}

/**
 * A field action's `retry`, with `refusals` more tries for anything but the
 * network. A refusal is measured by the move's own count (`countRefusals`); a
 * failure that was not counted — not an object, or a call made outside the
 * app's client — by TanStack's, as before.
 */
export function retryMoveAfter(refusals: number): ShouldRetry {
  const retry: ShouldRetry = (failureCount, error) => {
    if (isNetworkError(error)) {
      goOffline();
      return true;
    }
    const refusal = refusalOf(error);
    if (refusal === undefined) {
      return failureCount < refusals;
    }
    const isOwed = refusal.count <= refusals;
    if (!isOwed) {
      refusalsByMove.delete(refusal.move);
    }
    return isOwed;
  };
  moveRetries.add(retry);
  return retry;
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
 * way. After a refusal, the backoff of the move's own refusals: the outages
 * before it do not lengthen it.
 */
export function moveRetryDelay(failureCount: number, error: unknown): number {
  if (isNetworkError(error)) {
    return 0;
  }
  const refusal = refusalOf(error);
  return backoffDelay(refusal === undefined ? failureCount : refusal.count - 1);
}
