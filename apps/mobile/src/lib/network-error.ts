/**
 * Telling a failure of the network from one of the server — apart from
 * lib/online.ts, which reads the app's configuration: crash reports start
 * before that configuration is read and need this too
 * (docs/f11-native-review.md, С-2).
 */

/** What a fetch that never reached anything says, on Android, iOS and the web build. */
const NO_SIGNAL =
  /network request failed|failed to fetch|networkerror|load failed|network connection was lost|internet connection appears to be offline/i;

interface Failure {
  name?: unknown;
  message?: unknown;
  originalError?: unknown;
}

/**
 * A failure that is the network's, not the server's: the request never got an
 * answer. A refusal the server sent — with a status, a code, a hint — is not.
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { name, message, originalError } = error as Failure;
  if (name === 'AuthRetryableFetchError') {
    return true;
  }
  if (name === 'StorageUnknownError' && originalError !== undefined) {
    return isNetworkError(originalError);
  }
  // A thrown TypeError, or PostgREST's own answer to one: "TypeError: …".
  return typeof message === 'string' && NO_SIGNAL.test(message);
}
