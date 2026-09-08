import { INTL_LOCALES, currentLanguage, i18n } from '@/i18n';

import type { Problem, ProblemPriority, ProblemStatus } from './schema';

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** "10 ноября, 14:05" — when the report was made, in the phone's timezone. */
export function formatReportedAt(instant: string): string {
  const locale = INTL_LOCALES[currentLanguage()];
  const cached = dateFormatters.get(locale);
  const formatter =
    cached ??
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  if (cached === undefined) {
    dateFormatters.set(locale, formatter);
  }

  return formatter.format(new Date(instant));
}

export function problemStatusText(status: ProblemStatus): string {
  return i18n.t(`problems.statuses.${status}`);
}

export function problemPriorityText(priority: ProblemPriority): string {
  return i18n.t(`problems.priorities.${priority}`);
}

/** The listing's name, or the word for a report that has none. */
export function problemPlace(problem: Problem): string {
  return problem.property?.name ?? i18n.t('problems.noProperty');
}
