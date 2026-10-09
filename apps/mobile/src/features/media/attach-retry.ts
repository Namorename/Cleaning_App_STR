import { onlineManager } from '@tanstack/react-query';

import { goOffline, isNetworkError } from '@/lib/online';
import { RefusalError } from '@/lib/server-error';

import { TusRetryableError } from './tus';

/**
 * How the upload queue tries again (review of video part 2, finding 3; the
 * third pass on video, findings 1 and 2; the fourth, findings 1, 2 and 5; the
 * two whole-branch reviews of phone-1-2-0, finding 3 and item 7).
 *
 * Silence — a fetch that reached nothing, an RPC or a resumable upload whose
 * request got no answer at all — marks the queue offline, as the app's other
 * moves do (lib/move-retry.ts): the upload pauses until a look at the
 * server finds it, and is tried again. An outage in a stairwell must not use
 * up what a refusal is owed.
 *
 * Every way an upload can fail is bounded, so none of them loops for ever.
 * Each has its own count, per file, from the moment the file is handed to
 * the queue until it is in or removed (`forgetAttachCount`); once a count is
 * spent the upload fails — its tile offers «Повторить» and «Удалить», and
 * the step says why:
 *
 * - a refusal — three more tries;
 * - a storage busy, or one that kept losing its place — eight more;
 * - a piece that ran out of time with nothing of it arriving — three more,
 *   each given twice as long (`attachStalls`, tus.ts `patchStallMs`). The
 *   count is of stalls in a row on one piece: a stall on a later piece means
 *   the earlier one went through, and starts it again. Spent, it says the
 *   connection is too slow to send the video (`UploadTooSlowError`): a piece
 *   given ten minutes moved nothing, some 84 kbit/s up at best;
 * - any request of the upload left unanswered although there was signal —
 *   when the attempt began and when it ended — in an attempt that moved
 *   nothing: four more in a row. A photo, a chat photo's message and the
 *   registration and confirmation of either count the same as a video's
 *   pieces; a photo goes in one request and never moves part of the way. The
 *   look for the server goes to its health check, not to the storage; a
 *   storage host out of reach (a DNS filter, a proxy, an outage that does not
 *   answer) would otherwise be found "online" again and again. Without signal
 *   at either end it was the network's, and counts for nothing.
 *
 * Progress of the file into storage — more of it held than the storage has
 * ever said before — starts the counts of refusals, answers and silence
 * again: a storage that trips now and then is not one that will never take
 * the file. Pieces sent again to an upload the storage forgot and made anew
 * are not progress. Stalls keep their own rule, above.
 *
 * TanStack hands the retry decision only the count of failures, outages
 * included, so the failures are counted here, each failed attempt marked
 * with its number and its kind's limit.
 */

/** More tries after a refusal before the upload fails. */
export const ATTACH_RETRIES = 3;
/** More tries after the storage answered it was busy, or lost its place. */
export const ANSWERED_RETRIES = 8;
/** More tries after a piece ran out of time without a byte of it arriving. */
export const STALL_RETRIES = 3;
/** More attempts in a row that went unanswered while there was signal. */
export const SILENT_RETRIES = 4;

type Budget = 'refused' | 'answered' | 'stalled' | 'silent';

const LIMITS: Readonly<Record<Budget, number>> = {
  refused: ATTACH_RETRIES,
  answered: ANSWERED_RETRIES,
  stalled: STALL_RETRIES,
  silent: SILENT_RETRIES,
};

interface Counts {
  refused: number;
  answered: number;
  stalled: number;
  silent: number;
  /** Where the piece that stalled last began. */
  stalledAt: number | null;
  /** The most of the file the storage has said it holds; null before it said. */
  most: number | null;
  /** Whether the attempt under way began with signal. */
  hasBegunOnline: boolean;
  /** Whether the attempt under way moved the file on. */
  hasMoved: boolean;
}

const NONE: Counts = {
  refused: 0,
  answered: 0,
  stalled: 0,
  silent: 0,
  stalledAt: null,
  most: null,
  hasBegunOnline: false,
  hasMoved: false,
};

/** What each file's upload has met since it was handed to the queue, by media id. */
const countsByMedia = new Map<string, Counts>();
/** Which failure of its kind a failed attempt was, and how many its kind may have. */
const failureNumber = new WeakMap<object, { count: number; limit: number }>();

/**
 * A video whose piece kept running out of time, each try given longer, with
 * nothing of it arriving: her connection is too slow to send it. Said in her
 * language; the last stall's words stay in the message, for the log.
 */
export class UploadTooSlowError extends RefusalError {
  constructor(stall: Error) {
    super(`Video upload gave up, the connection too slow: ${stall.message}`, 'video.uploadTooSlow');
    this.name = 'UploadTooSlowError';
  }
}

/** No signal: the request got no answer at all. */
export function isNoSignal(error: unknown): boolean {
  if (error instanceof TusRetryableError) {
    return error.reason === 'no-answer' || error.reason === 'timed-out';
  }
  return isNetworkError(error);
}

function countsOf(mediaId: string): Counts {
  return countsByMedia.get(mediaId) ?? NONE;
}

/**
 * The count a failure is charged to, or null for none: silence counts only
 * with signal on both sides of an attempt that moved nothing — whichever
 * request of the chain it was — and anything else silent is the network's.
 */
function budgetOf(error: unknown, counts: Counts): Budget | null {
  if (isNoSignal(error)) {
    const isSilentWithSignal =
      counts.hasBegunOnline && onlineManager.isOnline() && !counts.hasMoved;
    return isSilentWithSignal ? 'silent' : null;
  }
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

/**
 * The file's counts let go: handed to the queue afresh — by the screen, or a
 * retry from its tile — and once it is in, or removed.
 */
export function forgetAttachCount(mediaId: string): void {
  countsByMedia.delete(mediaId);
}

/** An attempt of the file's upload begins: whether it has signal is noted. */
export function beginAttachAttempt(mediaId: string): void {
  countsByMedia.set(mediaId, {
    ...countsOf(mediaId),
    hasBegunOnline: onlineManager.isOnline(),
    hasMoved: false,
  });
}

/**
 * The storage said how much of the file it holds. More than it has ever said
 * is progress: the refusals, answers and silence counted so far are behind
 * it. An upload the storage forgot starts again from nothing, and its pieces
 * sent again move it on without getting the file any further in (item 7).
 */
export function noteAttachProgress(mediaId: string, sent: number): void {
  const counts = countsOf(mediaId);
  const hasMoved = counts.most !== null && sent > counts.most;
  const most = counts.most === null ? sent : Math.max(counts.most, sent);
  countsByMedia.set(
    mediaId,
    hasMoved
      ? { ...counts, most, refused: 0, answered: 0, silent: 0, hasMoved: true }
      : { ...counts, most },
  );
}

/**
 * An attempt of the file's upload failed: it is counted against its kind.
 * Returns the failure as the queue is to keep it — the same one, or, the
 * stalls spent, one that says the connection is too slow.
 */
export function countAttachFailure(mediaId: string, error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return error;
  }
  const budget = budgetOf(error, countsOf(mediaId));
  if (budget === null) {
    return error;
  }
  const counts = counted(countsOf(mediaId), budget, error);
  countsByMedia.set(mediaId, counts);
  const number = { count: counts[budget], limit: LIMITS[budget] };
  const kept =
    budget === 'stalled' && number.count > number.limit && error instanceof Error
      ? new UploadTooSlowError(error)
      : error;
  failureNumber.set(kept, number);
  return kept;
}

/**
 * How many attempts in a row ran out of time on the piece this video's
 * upload is at: the next one gives the piece that much longer.
 */
export function attachStalls(mediaId: string): number {
  return countsOf(mediaId).stalled;
}

/** TanStack's `retry` for the upload queue. */
export function retryAttach(failureCount: number, error: unknown): boolean {
  const number = typeof error === 'object' && error !== null ? failureNumber.get(error) : undefined;
  if (number !== undefined && number.count > number.limit) {
    return false;
  }
  if (isNoSignal(error)) {
    goOffline();
    return true;
  }
  if (number !== undefined) {
    return true;
  }
  return failureCount + 1 <= ATTACH_RETRIES;
}
