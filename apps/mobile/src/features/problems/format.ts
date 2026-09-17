import { propertyPathOf } from '@str-ops/shared';

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

/**
 * Where the problem is: the house, and the room inside it when it is one.
 *
 * A report filed from a cleaning stands on the room the cleaner was working,
 * and a room's own name — "1 - 2109" — names a door and no house. Through the
 * shared labeller so the phone and the panel spell a place identically, down
 * to the dash: they have to, or the panel's search stops finding what was
 * reported here.
 */
export function problemPlace(problem: Problem): string {
  return propertyPathOf(problem.property ?? null) ?? i18n.t('problems.noProperty');
}
