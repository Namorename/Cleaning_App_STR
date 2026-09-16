import { i18n } from '@/i18n';
import { serverErrorText, type ServerErrorText } from '@/lib/server-error';

/**
 * Why the sign-in did not go through, in words that are true.
 *
 * The screen used to answer "wrong email or password" to every failure it
 * caught. The intent was sound — saying which half was wrong turns a login
 * form into an account enumerator — but it swept up failures that are not
 * about credentials at all: no signal in the stairwell, auth rate-limiting a
 * second attempt, a project setting broken that morning. A cleaner holding a
 * password that works is then told the password is wrong, and the first thing
 * she does is ask for a new one she does not need. That is how a password
 * "not working" and then "working after a reset" looks from the inside, and
 * the screen could not tell the two apart because it never asked.
 *
 * So: the credentials answer stays deliberately vague about WHICH half was
 * wrong, and everything else says what actually happened. Nothing here reveals
 * whether an address exists — a rate limit and a dead network are facts about
 * the request, not about the account.
 */

/** Auth answers this when the pair does not match. Either half. Never says which. */
const WRONG_PAIR = ['invalid_credentials', 'invalid_grant'];

/** Too many tries, too fast. Auth counts per address and per address block. */
const TOO_MANY = ['over_request_rate_limit', 'over_email_send_rate_limit'];

const TOO_MANY_STATUS = 429;

/** The wrong pair, as older auth builds answer it: a status and no code. */
const WRONG_PAIR_STATUS = 400;

/** supabase-js wraps a failed fetch in this rather than letting it through raw. */
const NETWORK_ERROR_NAME = 'AuthRetryableFetchError';

interface AuthFailure {
  code?: unknown;
  status?: unknown;
  name?: unknown;
}

function asAuthFailure(error: unknown): AuthFailure {
  return typeof error === 'object' && error !== null ? (error as AuthFailure) : {};
}

/**
 * What to put on the screen.
 *
 * `detail` follows the rule the rest of the app follows: an error this build
 * cannot name shows a general sentence in her language, with the server's own
 * English underneath in small print, so she can forward it to the manager
 * instead of describing it.
 */
export function signInFailureText(error: unknown): ServerErrorText {
  const { code, status, name } = asAuthFailure(error);

  if (typeof code === 'string' && WRONG_PAIR.includes(code)) {
    return { text: i18n.t('auth.invalidCredentials'), detail: null };
  }

  if (name === NETWORK_ERROR_NAME) {
    return { text: i18n.t('auth.noConnection'), detail: null };
  }

  if (status === TOO_MANY_STATUS || (typeof code === 'string' && TOO_MANY.includes(code))) {
    return { text: i18n.t('auth.tooManyAttempts'), detail: null };
  }

  if (status === WRONG_PAIR_STATUS && code === undefined) {
    return { text: i18n.t('auth.invalidCredentials'), detail: null };
  }

  return serverErrorText(error);
}
