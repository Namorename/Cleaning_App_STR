import { INTL_LOCALES, type Language } from '@str-ops/shared';

import type { SupplyStatus } from './schema';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** New requests read loudest: they wait for the manager. */
export function statusVariant(status: SupplyStatus): BadgeVariant {
  switch (status) {
    case 'new':
      return 'default';
    case 'accepted':
    case 'ordered':
      return 'secondary';
    case 'fulfilled':
    case 'rejected':
      return 'outline';
  }
}

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

/** Today as `YYYY-MM-DD`, for a file name. */
export function fileStamp(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
