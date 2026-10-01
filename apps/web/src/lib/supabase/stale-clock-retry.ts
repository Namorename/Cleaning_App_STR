/**
 * PostgREST before 14.18 can refuse a valid token with 401 "JWT issued at future".
 *
 * Its clock is a cached value (the auto-update library), and after an idle
 * spell some of its threads keep reading a stale one, minutes behind
 * (PostgREST #5159 and #5196, fixed in 14.18 by reading the system clock). A
 * token issued after that moment — at sign-in, or by the refresh after a
 * night away — looks to such a thread as if it came from the future, past the
 * 30 seconds of skew PostgREST allows. The first reads of a quiet morning fail
 * while the very next ones pass. The cloud runs 14.5 (checked 2026-10-01).
 *
 * The refusal happens at the token check, before any SQL runs, so sending the
 * same request again is as safe for a write as for a read. Only REST requests
 * and only this refusal are sent again; every other answer goes back as it came.
 */
export const STALE_CLOCK_MESSAGE = 'JWT issued at future';

/**
 * The pause before each new attempt. One stale thread refuses; the next
 * request almost always reaches another, so the first pause is short.
 */
export const STALE_CLOCK_RETRY_DELAYS_MS: readonly number[] = [300, 1_000];

const REST_PATH = '/rest/v1/';

function addressOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function isRestRequest(input: RequestInfo | URL): boolean {
  return new URL(addressOf(input), 'http://localhost').pathname.includes(REST_PATH);
}

/** A Request that carries a body can be read once: sending it again would fail. */
function canSendAgain(input: RequestInfo | URL): boolean {
  return !(input instanceof Request) || input.body === null;
}

async function isStaleClockRefusal(response: Response): Promise<boolean> {
  if (response.status !== 401) {
    return false;
  }
  try {
    const body: unknown = await response.clone().json();
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as { message?: unknown }).message === STALE_CLOCK_MESSAGE
    );
  } catch {
    // A body that is not JSON is not PostgREST's refusal; it goes back as it came.
    return false;
  }
}

/** Resolves after `ms`, or rejects with the abort reason as soon as the request is cancelled. */
function pause(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A fetch that sends a REST request again, after a pause, while PostgREST
 * refuses its token for the stale clock — at most once per entry of
 * `delaysMs`. The last answer, refusal or not, is returned unread.
 */
export function withStaleClockRetry(
  fetchImpl: typeof fetch,
  delaysMs: readonly number[] = STALE_CLOCK_RETRY_DELAYS_MS,
): typeof fetch {
  return async (input, init) => {
    let response = await fetchImpl(input, init);
    if (!isRestRequest(input) || !canSendAgain(input)) {
      return response;
    }
    for (const delayMs of delaysMs) {
      if (!(await isStaleClockRefusal(response))) {
        return response;
      }
      await pause(delayMs, init?.signal);
      response = await fetchImpl(input, init);
    }
    return response;
  };
}

/**
 * What both of the panel's clients send through. The global fetch is looked up
 * on every call, not captured once, so whatever the runtime puts there (Next's
 * own fetch on the server) is still the one used.
 */
export const staleClockSafeFetch: typeof fetch = withStaleClockRetry((input, init) =>
  fetch(input, init),
);
