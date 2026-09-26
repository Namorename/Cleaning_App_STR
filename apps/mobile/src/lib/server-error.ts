import { serverErrorOptions } from '@str-ops/shared';

import { i18n } from '@/i18n';

/**
 * What a database function raised, as supabase-js hands it over.
 *
 * The server never sends text meant for a person to read: it has no idea who
 * is reading, and this team speaks three languages. It sends an English
 * message for the logs, a stable i18n key in `hint`, and that key's
 * parameters as a JSON object in `details`. The reader's language lives in
 * the app, so the translation happens here.
 */
interface RaisedError {
  message?: unknown;
  hint?: unknown;
  details?: unknown;
}

export interface ServerErrorText {
  /** Shown to the reader, in the language they chose. */
  text: string;
  /**
   * The server's own English words, kept only for an error we could not
   * translate. Shown small underneath, so a cleaner can pass it on.
   */
  detail: string | null;
}

const KEY_PREFIX = 'serverErrors.';
const UNKNOWN_KEY = 'serverErrors.unknown';

/**
 * A refusal the app reads off an answer itself, in the server's shape.
 *
 * An update whose filters matched no row says "no" without an error — a
 * colleague took the task first, or it moved on meanwhile. The app raises it
 * the way a database function would: English for the logs, and the key of
 * the sentence the reader gets. Its key lives with its feature ("tasks.…"),
 * not under `serverErrors.`, which only the server's own hints may use.
 */
export class RefusalError extends Error {
  readonly key: string;

  constructor(message: string, key: string) {
    super(message);
    this.name = 'RefusalError';
    this.key = key;
  }
}

function asRaised(error: unknown): RaisedError {
  return typeof error === 'object' && error !== null ? (error as RaisedError) : {};
}

/** The key's parameters, or none when the server sent something else. */
function parameters(details: unknown): Record<string, unknown> {
  if (typeof details !== 'string' || details.trim() === '') {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(details);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The i18n key a refusal carries, when it carries one this build knows. */
export function serverErrorKey(error: unknown): string | null {
  if (error instanceof RefusalError) {
    return i18n.exists(error.key) ? error.key : null;
  }
  const { hint, details } = asRaised(error);
  // A counted key exists only in its plural forms, so it is looked up with
  // its count — and without one it is not a key this build can read.
  return typeof hint === 'string' &&
    hint.startsWith(KEY_PREFIX) &&
    i18n.exists(hint, serverErrorOptions(hint, parameters(details)))
    ? hint
    : null;
}

/**
 * Turn a failure into something worth showing.
 *
 * A key this build knows is translated with its parameters filled in. Anything
 * else — an older function that still speaks prose, a network failure, a key
 * added after this build shipped — becomes one general sentence in the
 * reader's language, with the raw message underneath rather than thrown away.
 */
export function serverErrorText(error: unknown): ServerErrorText {
  const { details, message } = asRaised(error);
  const key = serverErrorKey(error);

  if (key !== null) {
    return { text: i18n.t(key, serverErrorOptions(key, parameters(details))), detail: null };
  }

  return {
    text: i18n.t(UNKNOWN_KEY),
    detail: typeof message === 'string' && message.trim() !== '' ? message : null,
  };
}

/** Between the sentence and the raw words: a paragraph break. */
const PARAGRAPH = '\n\n';

/**
 * A failure as the body of an alert, which has no small print to put the raw
 * words in: the sentence first, and the server's English as a paragraph of
 * its own under it — there for her to forward, not to read.
 */
export function alertMessage(failure: ServerErrorText): string {
  return failure.detail === null ? failure.text : `${failure.text}${PARAGRAPH}${failure.detail}`;
}
