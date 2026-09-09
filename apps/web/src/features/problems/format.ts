import { INTL_LOCALES, type Language } from '@str-ops/shared';

import type { ProblemPriority, ProblemStatus, TaskStep } from './schema';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** How loud a status reads on the board. */
export function statusVariant(status: ProblemStatus): BadgeVariant {
  switch (status) {
    case 'open':
      return 'destructive';
    case 'assigned':
    case 'in_progress':
      return 'default';
    case 'resolved':
      return 'secondary';
    case 'cancelled':
      return 'outline';
  }
}

export function priorityVariant(priority: ProblemPriority): BadgeVariant {
  switch (priority) {
    case 'high':
      return 'destructive';
    case 'normal':
      return 'secondary';
    case 'low':
      return 'outline';
  }
}

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

/** `HH:MM:SS` from the database as `HH:MM`. */
export function formatClock(time: string): string {
  return time.slice(0, 5);
}

/** The step's title in the manager's language, falling back to the company's words. */
export function stepTitle(
  step: Pick<TaskStep, 'title' | 'title_i18n'>,
  language: Language,
): string | null {
  return step.title_i18n?.[language] ?? step.title;
}

/** Today's calendar day as the date input wants it. */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
