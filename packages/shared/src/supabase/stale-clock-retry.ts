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
 * The refusal is recognised by its body, so a HEAD request (a count asked with
 * `head: true`, which neither app sends) gets no second try.
 *
 * Two clients go through it: the panel's browser client and the phone's.
 * - The panel reads PostgREST in the browser alone; its server's client and
 *   the proxy's talk to Auth (apps/web client-factories.test.ts). A table read
 *   on the server would need more than this: inside a render Next memoizes
 *   identical GET requests, and the resend would get the same refusal back
 *   from that memo. It would have to differ — a marker header, as postgrest-js
 *   sends `X-Retry-Count` on its own retries, or a signal.
 * - The phone's retries of TanStack Query sit on top of this one; they are
 *   seconds apart, and an action is tried only once more.
 *
 * Written for both runtimes: React Native has no `Request` or `URL` it can be
 * trusted with everywhere, so neither is required to exist and the address is
 * read as plain text.
 */
export const STALE_CLOCK_MESSAGE = 'JWT issued at future';

/**
 * The pause before each new attempt. One stale thread refuses; the next
 * request almost always reaches another, so the first pause is short.
 */
export const STALE_CLOCK_RETRY_DELAYS_MS: readonly number[] = [300, 1_000];

const REST_PATH = '/rest/v1/';

function isRequest(input: unknown): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function isUrl(input: unknown): input is URL {
  return typeof URL !== 'undefined' && input instanceof URL;
}

function addressOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (isUrl(input)) {
    return input.href;
  }
  return isRequest(input) ? input.url : String(input);
}

/** The path of the address — what comes before its query or fragment. */
function isRestRequest(input: RequestInfo | URL): boolean {
  return (addressOf(input).split(/[?#]/, 1)[0] ?? '').includes(REST_PATH);
}

/** A Request that carries a body can be read once: sending it again would fail. */
function canSendAgain(input: RequestInfo | URL): boolean {
  return !isRequest(input) || input.body === null;
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
 * What the panel's browser client sends through. The global fetch is looked
 * up on every call, not captured once, so whatever the page puts there later
 * is still the one used.
 */
export const staleClockSafeFetch: typeof fetch = withStaleClockRetry((input, init) =>
  fetch(input, init),
);
