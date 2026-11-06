import { INTL_LOCALES, type Language } from '@str-ops/shared';

import { formatNumber } from '@/features/analytics/format';
import { dateFormat } from '@/lib/format-date';

/** Whole from one up: a decimal on three episodes would promise more than they know. */
export function formatRate(rate: number, language: Language): string {
  return formatNumber(rate, language, rate >= 1 ? 0 : 1);
}

/** An average of ratings out of 10, to one decimal. */
export function formatRating(average: number, language: Language): string {
  return formatNumber(average, language, 1);
}

function monthFormat(day: string, language: Language, options: Intl.DateTimeFormatOptions): string {
  const [year, month] = day.split('-').map(Number);
  return dateFormat(INTL_LOCALES[language], options).format(new Date(year, month - 1, 1));
}

/** A month under a column: "нояб.". */
export function formatShortMonth(day: string, language: Language): string {
  return monthFormat(day, language, { month: 'short' });
}

/** A month in words: "ноябрь 2026 г.". */
export function formatLongMonth(day: string, language: Language): string {
  return monthFormat(day, language, { month: 'long', year: 'numeric' });
}
