import {
  STATUS_TONE,
  plannedDay,
  problemLevelTone,
  propertyPathOf,
  todayInZone,
  type PlannedDay,
  type ProblemLevel,
  type Tone,
} from '@str-ops/shared';

import { formatCalendarDate } from '@/features/tasks/format';
import { INTL_LOCALES, currentLanguage, i18n } from '@/i18n';

import type { Problem, ProblemStatus } from './schema';

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

/** «Низкая» … «Критическая»: a level on the scale of four (`problemLevel`). */
export function problemPriorityText(level: ProblemLevel): string {
  return i18n.t(`problems.priorities.${level}`);
}

/** The chip of a task the office must see first: its word and its tone. */
export interface UrgencyChip {
  label: string;
  tone: Tone;
}

/**
 * «Критическая» filled in the strongest tone for the level above high (owner,
 * 2026-11-15), «Срочно» for high — the word the task screen and the supply
 * request use for the same flag — and nothing below.
 */
export function urgencyChip(level: ProblemLevel): UrgencyChip | null {
  if (level === 'critical') {
    return { label: problemPriorityText('critical'), tone: problemLevelTone('critical') };
  }
  if (level === 'high') {
    return { label: i18n.t('supplies.priorities.urgent'), tone: problemLevelTone('high') };
  }
  return null;
}

/** «Сегодня», «Завтра», or the day itself — «пт, 4 декабря» — in her language. */
export function plannedDayText(planned: PlannedDay): string {
  switch (planned.kind) {
    case 'today':
      return i18n.t('problems.due.today');
    case 'tomorrow':
      return i18n.t('problems.due.tomorrow');
    default:
      return formatCalendarDate(planned.day);
  }
}

/** What the planned day's chip reads of a task: a board's row and her own alike. */
export interface DueFacts {
  status: ProblemStatus;
  due_on: string | null;
  property?: { timezone?: string | null } | null;
}

/**
 * «Дата: Завтра» — the day the office planned a live task for (owner,
 * 2026-11-26), counted in its listing's zone; today's in the today tone, any
 * other day neutral. Null when nothing is planned, or the task is closed: it
 * waits for no day.
 */
export function dueChip(problem: DueFacts, now: Date): UrgencyChip | null {
  if (problem.status === 'resolved' || problem.status === 'cancelled') {
    return null;
  }
  const planned = plannedDay(problem.due_on, todayInZone(problem.property?.timezone, now));
  if (planned === null) {
    return null;
  }
  return {
    label: i18n.t('problems.due.chip', { when: plannedDayText(planned) }),
    tone: planned.kind === 'today' ? STATUS_TONE['calendar.today'] : 'neutral',
  };
}

/**
 * The planned day as the task's screen says it, in any status: «Завтра · пт,
 * 27 ноября» for today and tomorrow, the date alone for any other; null when
 * nothing is planned.
 */
export function dueDayLine(
  problem: Pick<DueFacts, 'due_on' | 'property'>,
  now: Date,
): string | null {
  if (problem.due_on === null) {
    return null;
  }
  const date = formatCalendarDate(problem.due_on);
  const planned = plannedDay(problem.due_on, todayInZone(problem.property?.timezone, now));
  return planned?.kind === 'today' || planned?.kind === 'tomorrow'
    ? `${plannedDayText(planned)} · ${date}`
    : date;
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
export function problemPlace(problem: Pick<Problem, 'property'>): string {
  return propertyPathOf(problem.property ?? null) ?? i18n.t('problems.noProperty');
}
