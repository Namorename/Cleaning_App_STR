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

/**
 * Turn a failure into something worth showing.
 *
 * A key this build knows is translated with its parameters filled in. Anything
 * else — an older function that still speaks prose, a network failure, a key
 * added after this build shipped — becomes one general sentence in the
 * reader's language, with the raw message underneath rather than thrown away.
 */
export function serverErrorText(error: unknown): ServerErrorText {
  const { hint, details, message } = asRaised(error);

  if (typeof hint === 'string' && hint.startsWith(KEY_PREFIX) && i18n.exists(hint)) {
    return { text: i18n.t(hint, parameters(details)), detail: null };
  }

  return {
    text: i18n.t(UNKNOWN_KEY),
    detail: typeof message === 'string' && message.trim() !== '' ? message : null,
  };
}
