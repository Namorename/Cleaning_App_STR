import { i18n } from '@/i18n';
import { serverErrorText, type ServerErrorText } from '@/lib/server-error';
import { supabase } from '@/lib/supabase';

/**
 * The shortest new password the phone will send.
 *
 * Mirrors `minimum_password_length` in supabase/config.toml (6). The hosted
 * project keeps its own value (Dashboard → Authentication → Providers →
 * Email) and it has to be checked by hand: if the cloud asks for more, the
 * server's `weak_password` answer is what she sees instead of this check.
 */
export const MIN_PASSWORD_LENGTH = 6;

export interface PasswordDraft {
  current: string;
  next: string;
  repeat: string;
}

/** What is wrong with the form before anything is sent; each is a key under `settings.password`. */
export type PasswordIssue = 'fillAll' | 'mismatch' | 'sameAsCurrent' | 'tooShort';

/**
 * Judged the way the sign-in screen will read the password later: trimmed.
 * That screen drops spaces around what she types (a password pasted with a
 * trailing space), so a new password ending in one would be unusable as
 * typed; trimmed, it is the same password whichever way she types it.
 */
export function passwordDraftIssue(draft: PasswordDraft): PasswordIssue | null {
  const current = draft.current.trim();
  const next = draft.next.trim();
  const repeat = draft.repeat.trim();

  if (current === '' || next === '' || repeat === '') {
    return 'fillAll';
  }
  if (next !== repeat) {
    return 'mismatch';
  }
  if (next === current) {
    return 'sameAsCurrent';
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return 'tooShort';
  }
  return null;
}

export interface PasswordChange {
  email: string;
  current: string;
  next: string;
}

/**
 * Change her password while she is signed in. Online only: no queue, because
 * a password waiting on disk for signal is a password in plain text on disk.
 *
 * 1. Signing in again with the current password is the check that she knows
 *    it. It also makes the session updateUser runs on a new one: with "Secure
 *    password change" on, Auth asks for a code by e-mail when that session is
 *    more than 24 hours old (`session.CreatedAt`, supabase/auth v2.197.0
 *    internal/api/user.go#L154-L165), and there is no mail to send it with. A
 *    failed sign-in leaves the session she has untouched.
 * 2. The new password is set, with the current one beside it: ignored unless
 *    the separate "require current password" setting is on (GoTrue v2.190+),
 *    and then it is what that setting asks for.
 * 3. Every other sign-in is closed (owner's decision 15) by Auth itself, as
 *    part of the change (`LogoutAllExceptMe` in `UpdatePassword`, v2.197.0
 *    internal/models/user.go#L459-L462). A sign-out of our own on top of it
 *    could only fail, and then say other devices are still in when they are
 *    not.
 */
export async function changePassword(change: PasswordChange): Promise<void> {
  if (change.email === '') {
    throw new Error('The signed-in account has no email address');
  }

  const checked = await supabase.auth.signInWithPassword({
    email: change.email,
    password: change.current.trim(),
  });
  if (checked.error) {
    throw checked.error;
  }

  const updated = await supabase.auth.updateUser({
    password: change.next.trim(),
    current_password: change.current.trim(),
  });
  if (updated.error) {
    throw updated.error;
  }
}

/** Auth's codes for the refusals she can act on, and the sentence each one gets. */
const KNOWN_CODES: ReadonlyMap<string, string> = new Map([
  ['invalid_credentials', 'settings.password.wrongCurrent'],
  // "Require current password" on in the cloud (GoTrue v2.190+).
  ['current_password_invalid', 'settings.password.wrongCurrent'],
  ['current_password_required', 'settings.password.wrongCurrent'],
  // "Secure password change" on, and a token refresh raced the fresh sign-in
  // of step 1: the next tap signs in again and goes through.
  ['reauthentication_needed', 'settings.password.confirmAgain'],
  ['weak_password', 'settings.password.weak'],
  ['same_password', 'settings.password.sameAsCurrent'],
  ['over_request_rate_limit', 'auth.tooManyAttempts'],
]);

const TOO_MANY_STATUS = 429;

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
 * Why the password did not change, as a sentence in her language. A refusal
 * this build cannot name shows the general sentence with auth's own English
 * small underneath, for her to forward to the manager.
 */
export function passwordFailureText(error: unknown): ServerErrorText {
  const { code, status, name } = asAuthFailure(error);

  if (name === NETWORK_ERROR_NAME) {
    return { text: i18n.t('settings.password.needsNetwork'), detail: null };
  }
  const key = typeof code === 'string' ? KNOWN_CODES.get(code) : undefined;
  if (key !== undefined) {
    return { text: i18n.t(key), detail: null };
  }
  if (status === TOO_MANY_STATUS) {
    return { text: i18n.t('auth.tooManyAttempts'), detail: null };
  }
  return serverErrorText(error);
}
