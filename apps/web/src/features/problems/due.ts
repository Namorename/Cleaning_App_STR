import { DUE_DAYS_AHEAD, type PlannedDay } from '@str-ops/shared';

import { addDays } from '@/features/calendar/dates';
import { todayIso } from '@/lib/format-date';

/**
 * The day a task is to be done (owner, 2026-11-26; 20261126130000), as the panel says and asks
 * for it. Pure functions: the components are problem-due.tsx.
 */

type Translate = (key: string) => string;

/** «Сегодня», «Завтра», or the day itself as `formatOf` writes it. */
export function plannedDayWords(
  planned: PlannedDay,
  t: Translate,
  formatOf: (day: string) => string,
): string {
  switch (planned.kind) {
    case 'today':
      return t('problems.due.today');
    case 'tomorrow':
      return t('problems.due.tomorrow');
    default:
      return formatOf(planned.day);
  }
}

/**
 * The days a date field offers: today up to a day short of DUE_DAYS_AHEAD — the server counts from
 * its UTC day, which in Prague is a day behind the browser's after midnight.
 */
export function dueDayRange(today: string = todayIso()): { min: string; max: string } {
  return { min: today, max: addDays(today, DUE_DAYS_AHEAD - 1) };
}
