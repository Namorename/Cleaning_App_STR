import { goOffline, isNetworkError } from '@/lib/online';

import { TusRetryableError } from './tus';

/**
 * How the upload queue tries again (review of video part 2, finding 3).
 *
 * A failure of the network — a fetch that reached nothing, or a resumable
 * upload that gave up on the network after its own short tries — marks the
 * queue offline, as the app's other moves do (lib/query-client.ts): the
 * upload pauses until a look at the server finds it, and is tried again
 * without spending a try. An outage in a stairwell must not use up what a
 * refusal is owed. Only refusals count: an upload refused gets three more
 * tries, however many outages came before, and then it fails so the step
 * can say why.
 *
 * TanStack hands the retry decision only the count of failures, outages
 * included, so the refusals are counted here: per file, from the moment it
 * is handed to the queue (`startAttachCount`), each refusal marked with its
 * number.
 */

/** More tries after a refusal before the upload fails. */
export const ATTACH_RETRIES = 3;

/** Refusals of each file's upload since it was handed to the queue, by media id. */
const refusalsByMedia = new Map<string, number>();
/** Which refusal of its upload a refused attempt was. */
const refusalNumber = new WeakMap<object, number>();

/** No signal, not an answer from the server. */
export function isNoSignal(error: unknown): boolean {
  return error instanceof TusRetryableError || isNetworkError(error);
}

/** A file handed to the queue afresh — by the screen, or a retry from its tile. */
export function startAttachCount(mediaId: string): void {
  refusalsByMedia.delete(mediaId);
}

/** An attempt of the file's upload failed: a refusal is counted against it. */
export function countAttachFailure(mediaId: string, error: unknown): void {
  if (isNoSignal(error) || typeof error !== 'object' || error === null) {
    return;
  }
  const count = (refusalsByMedia.get(mediaId) ?? 0) + 1;
  refusalsByMedia.set(mediaId, count);
  refusalNumber.set(error, count);
}

/** TanStack's `retry` for the upload queue. */
export function retryAttach(failureCount: number, error: unknown): boolean {
  if (isNoSignal(error)) {
    goOffline();
    return true;
  }
  const counted =
    typeof error === 'object' && error !== null ? refusalNumber.get(error) : undefined;
  return (counted ?? failureCount + 1) <= ATTACH_RETRIES;
}
