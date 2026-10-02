import { onlineManager } from '@tanstack/react-query';

import { env } from '@/lib/env';

/**
 * Whether the phone can reach the server, as the query client needs to know.
 *
 * TanStack learns about the network from the browser's online and offline
 * events; a phone has none, so out of the box the client believes it is
 * always online. A move tapped without signal then failed after one retry
 * instead of waiting on disk — the whole point of the offline queue
 * (lib/query-client.ts). Until the native build brings NetInfo (1.1.0), the
 * phone learns it the only way it can in JavaScript: a request that failed
 * for the network says "offline", and a look at the server now and then says
 * when it is back. Going online resumes every move paused meanwhile.
 */

/** How often to look for the server while it cannot be reached. */
export const PROBE_INTERVAL_MS = 15_000;

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

/** One look at the server: any answer at all means the network is back. */
export async function probeServer(): Promise<void> {
  await fetch(`${env.supabaseUrl}/auth/v1/health`, {
    headers: { apikey: env.supabasePublishableKey },
  });
}

let watch: ReturnType<typeof setInterval> | null = null;

/** Stop looking for the server; the next failure starts again. */
export function stopWatchingConnection(): void {
  if (watch !== null) {
    clearInterval(watch);
    watch = null;
  }
}

/**
 * Look once, now: when the app comes back to the front, the stairwell may be
 * long behind her.
 */
export async function checkConnection(probe: () => Promise<void> = probeServer): Promise<void> {
  try {
    await probe();
  } catch {
    // Still nothing: the watch keeps looking.
    return;
  }
  stopWatchingConnection();
  onlineManager.setOnline(true);
}

/**
 * No signal: the client is told it is offline — moves pause instead of
 * failing — and the server is looked for every PROBE_INTERVAL_MS until found.
 */
export function goOffline(probe: () => Promise<void> = probeServer): void {
  onlineManager.setOnline(false);
  if (watch === null) {
    watch = setInterval(() => void checkConnection(probe), PROBE_INTERVAL_MS);
  }
}
