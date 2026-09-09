import { i18n } from '@/lib/i18n';

/**
 * What a database function raised, as supabase-js hands it over.
 *
 * The server never sends text meant for a person: it sends an English
 * message for the logs, a stable i18n key in `hint` and that key's
 * parameters as JSON in `details`. The manager's language lives in the
 * panel, so the translation happens here — with the same dictionary the
 * cleaner's phone uses.
 */
interface RaisedError {
  message?: unknown;
  hint?: unknown;
  details?: unknown;
}

export interface ServerErrorText {
  /** Shown to the reader, in their language. */
  text: string;
  /** The server's own English words, kept only for an error without a key. */
  detail: string | null;
}

const KEY_PREFIX = 'serverErrors.';
const UNKNOWN_KEY = 'serverErrors.unknown';

function asRaised(error: unknown): RaisedError {
  return typeof error === 'object' && error !== null ? (error as RaisedError) : {};
}

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
