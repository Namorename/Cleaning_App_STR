import { INTL_LOCALES, type Language } from '@str-ops/shared';

const formats = new Map<string, Intl.DateTimeFormat>();

/**
 * One Intl.DateTimeFormat per locale and options, built on first use and kept:
 * building one costs far more than using it, and the calendar formats in every
 * row it draws (ROADMAP, the 7.6 tail). A zone the browser does not know
 * throws here, before anything is kept, exactly as a fresh build would.
 */
export function dateFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale} ${JSON.stringify(options)}`;
  const known = formats.get(key);
  if (known !== undefined) {
    return known;
  }
  const made = new Intl.DateTimeFormat(locale, options);
  formats.set(key, made);
  return made;
}

/** An ISO timestamp as the manager reads it: "9 сент. 2026 г., 14:05". */
export function formatDateTime(iso: string, language: Language): string {
  return dateFormat(INTL_LOCALES[language], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/** A `YYYY-MM-DD` date, read as a calendar day rather than an instant. */
export function formatDay(day: string, language: Language): string {
  const [year, month, date] = day.split('-').map(Number);
  return dateFormat(INTL_LOCALES[language], { dateStyle: 'medium' }).format(
    new Date(year, month - 1, date),
  );
}

/** A `YYYY-MM-DD` date as day and month only — "22.09" — for a short label on a card. */
export function formatShortDay(day: string, language: Language): string {
  const [year, month, date] = day.split('-').map(Number);
  return dateFormat(INTL_LOCALES[language], {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(year, month - 1, date));
}

/** Today's calendar day as `YYYY-MM-DD`: what a date input and a file name want. */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Today's calendar day in a property's own time zone, as `YYYY-MM-DD` — the
 * day the server's staleness and grace rules count by. A property with no
 * zone, or one the browser does not know, falls back to the browser's day:
 * a wrong zone must not blank a label, and every property today is in
 * Central Europe, where the two agree.
 */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  if (!timeZone) {
    return todayIso(now);
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = dateFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  } catch {
    // RangeError: the zone is unknown to this browser. Fall back, as above.
    return todayIso(now);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((one) => one.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
