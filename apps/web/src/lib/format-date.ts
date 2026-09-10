import { INTL_LOCALES, type Language } from '@str-ops/shared';

/** An ISO timestamp as the manager reads it: "9 сент. 2026 г., 14:05". */
export function formatDateTime(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[language], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/** A `YYYY-MM-DD` date, read as a calendar day rather than an instant. */
export function formatDay(day: string, language: Language): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(INTL_LOCALES[language], { dateStyle: 'medium' }).format(
    new Date(year, month - 1, date),
  );
}

/** Today's calendar day as `YYYY-MM-DD`: what a date input and a file name want. */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
