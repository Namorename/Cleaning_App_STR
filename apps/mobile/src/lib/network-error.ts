/**
 * Telling a failure of the network from one of the server — apart from
 * lib/online.ts, which reads the app's configuration: crash reports start
 * before that configuration is read and need this too
 * (docs/f11-native-review.md, С-2).
 */

/**
 * What a fetch that never reached anything says, on Android, iOS and the web
 * build — and expo/fetch, the app's fetch, in its own words («fetch failed»),
 * with OkHttp's on Android beneath it: no DNS, no connection.
 */
const NO_SIGNAL =
  /network request failed|failed to fetch|networkerror|load failed|network connection was lost|internet connection appears to be offline|^fetch failed|unable to resolve host|failed to connect to/i;

/**
 * A socket that went silent: OkHttp's «timeout», alone, and the platforms'
 * «timed out». Read only on a failure that carries no answer — a server
 * speaks of its own waits too (PostgREST's PGRST003 «Timed out acquiring
 * connection…», a database's «statement timeout», a gateway's 504), and
 * those are answers.
 */
const SILENT_SOCKET = /^timeout$|timed out/i;

interface Failure {
  name?: unknown;
  message?: unknown;
  originalError?: unknown;
  status?: unknown;
  code?: unknown;
}

/** A status or a code: the server answered. PostgREST's fetch failures carry an empty code. */
function hasAnswer({ status, code }: Failure): boolean {
  const hasStatus = typeof status === 'number' && status > 0;
  const hasCode = (typeof code === 'string' && code !== '') || typeof code === 'number';
  return hasStatus || hasCode;
}

/**
 * A failure that is the network's, not the server's: the request never got an
 * answer. A refusal the server sent — with a status, a code, a hint — is not.
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const failure = error as Failure;
  const { name, message, originalError } = failure;
  if (name === 'AuthRetryableFetchError') {
    return true;
  }
  if (name === 'StorageUnknownError' && originalError !== undefined) {
    return isNetworkError(originalError);
  }
  if (typeof message !== 'string') {
    return false;
  }
  // A thrown TypeError, or PostgREST's own answer to one: "TypeError: …".
  return NO_SIGNAL.test(message) || (!hasAnswer(failure) && SILENT_SOCKET.test(message));
}
