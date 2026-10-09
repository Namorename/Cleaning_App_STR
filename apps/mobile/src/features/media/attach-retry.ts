import { goOffline, isNetworkError } from '@/lib/online';

import { TusRetryableError } from './tus';

/**
 * How the upload queue tries again (review of video part 2, finding 3; the
 * third pass on video, findings 1 and 2).
 *
 * Silence — a fetch that reached nothing, a resumable upload whose request
 * got no answer at all — marks the queue offline, as the app's other moves
 * do (lib/query-client.ts): the upload pauses until a look at the server
 * finds it, and is tried again without spending a try. An outage in a
 * stairwell must not use up what a refusal is owed.
 *
 * Anything the server or its storage answered spends a try, or the queue
 * would wait for a signal it already has, for ever. Each kind of answer has
 * its own count, per file, from the moment it is handed to the queue
 * (`startAttachCount`), and once a count is spent the upload fails — its
 * tile offers «Повторить» and «Удалить», and the step says why:
 *
 * - a refusal — three more tries;
 * - a storage busy, or one that kept losing its place — eight more;
 * - a piece that ran out of time with nothing of it arriving — three more,
 *   each given twice as long (`attachStalls`, tus.ts `patchStallMs`). The
 *   count is of stalls in a row on one piece: a stall on a later piece means
 *   the earlier one went through, and starts it again.
 *
 * TanStack hands the retry decision only the count of failures, outages
 * included, so the answers are counted here, each failed attempt marked with
 * its number and its kind's limit.
 */

/** More tries after a refusal before the upload fails. */
export const ATTACH_RETRIES = 3;
/** More tries after the storage answered it was busy, or lost its place. */
export const ANSWERED_RETRIES = 8;
/** More tries after a piece ran out of time without a byte of it arriving. */
export const STALL_RETRIES = 3;

type Budget = 'refused' | 'answered' | 'stalled';

const LIMITS: Readonly<Record<Budget, number>> = {
  refused: ATTACH_RETRIES,
  answered: ANSWERED_RETRIES,
  stalled: STALL_RETRIES,
};

interface Counts {
  refused: number;
  answered: number;
  stalled: number;
  /** Where the piece that stalled last began. */
  stalledAt: number | null;
}

const NONE: Counts = { refused: 0, answered: 0, stalled: 0, stalledAt: null };

/** What each file's upload has been answered since it was handed to the queue, by media id. */
const countsByMedia = new Map<string, Counts>();
/** Which failure of its kind a failed attempt was, and how many its kind may have. */
const failureNumber = new WeakMap<object, { count: number; limit: number }>();

/** No signal: the request got no answer at all. */
export function isNoSignal(error: unknown): boolean {
  if (error instanceof TusRetryableError) {
    return error.reason === 'no-answer' || error.reason === 'timed-out';
  }
  return isNetworkError(error);
}

function budgetOf(error: unknown): Budget {
  if (!(error instanceof TusRetryableError)) {
    return 'refused';
  }
  return error.reason === 'stalled' ? 'stalled' : 'answered';
}

function counted(counts: Counts, budget: Budget, error: unknown): Counts {
  if (budget !== 'stalled') {
    return { ...counts, [budget]: counts[budget] + 1 };
  }
  const offset = error instanceof TusRetryableError ? (error.offset ?? null) : null;
  const isSamePiece = counts.stalledAt !== null && counts.stalledAt === offset;
  return { ...counts, stalled: isSamePiece ? counts.stalled + 1 : 1, stalledAt: offset };
}

/** A file handed to the queue afresh — by the screen, or a retry from its tile. */
export function startAttachCount(mediaId: string): void {
  countsByMedia.delete(mediaId);
}

/** An attempt of the file's upload failed: an answer is counted against it. */
export function countAttachFailure(mediaId: string, error: unknown): void {
  if (isNoSignal(error) || typeof error !== 'object' || error === null) {
    return;
  }
  const budget = budgetOf(error);
  const counts = counted(countsByMedia.get(mediaId) ?? NONE, budget, error);
  countsByMedia.set(mediaId, counts);
  failureNumber.set(error, { count: counts[budget], limit: LIMITS[budget] });
}

/**
 * How many attempts in a row ran out of time on the piece this video's
 * upload is at: the next one gives the piece that much longer.
 */
export function attachStalls(mediaId: string): number {
  return countsByMedia.get(mediaId)?.stalled ?? 0;
}

/** TanStack's `retry` for the upload queue. */
export function retryAttach(failureCount: number, error: unknown): boolean {
  if (isNoSignal(error)) {
    goOffline();
    return true;
  }
  const number = typeof error === 'object' && error !== null ? failureNumber.get(error) : undefined;
  if (number !== undefined) {
    return number.count <= number.limit;
  }
  return failureCount + 1 <= ATTACH_RETRIES;
}
