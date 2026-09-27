import { FALLBACK_LANGUAGE, isSupportedLanguage, serverErrorOptions } from '@str-ops/shared';

import { formatDay } from '@/lib/format-date';
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

/**
 * The key a refusal carries, whether or not this build can translate it: what
 * a caller branches on, where `serverErrorKey` is what it shows.
 */
export function serverErrorHint(error: unknown): string | null {
  const { hint } = asRaised(error);
  return typeof hint === 'string' ? hint : null;
}

/** The i18n key a refusal carries, when it carries one this build knows. */
export function serverErrorKey(error: unknown): string | null {
  const { hint, details } = asRaised(error);
  // A counted key exists only in its plural forms, so it is looked up with
  // its count — and without one it is not a key this build can read.
  return typeof hint === 'string' &&
    hint.startsWith(KEY_PREFIX) &&
    i18n.exists(hint, serverErrorOptions(hint, parameters(details)))
    ? hint
    : null;
}

/** A day as the server names it, `YYYY-MM-DD`. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The parameters as the reader reads them: a day the server names — the day a
 * task already stands on, or was moved to — becomes a date in the reader's
 * language. Only the panel does this; the phone reads its own.
 */
function readable(values: Record<string, unknown>): Record<string, unknown> {
  const language = isSupportedLanguage(i18n.language) ? i18n.language : FALLBACK_LANGUAGE;
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === 'string' && ISO_DAY.test(value) ? formatDay(value, language) : value,
    ]),
  );
}

export function serverErrorText(error: unknown): ServerErrorText {
  const { details, message } = asRaised(error);
  const key = serverErrorKey(error);

  if (key !== null) {
    return {
      text: i18n.t(key, serverErrorOptions(key, readable(parameters(details)))),
      detail: null,
    };
  }

  return {
    text: i18n.t(UNKNOWN_KEY),
    detail: typeof message === 'string' && message.trim() !== '' ? message : null,
  };
}
