import type { Language } from '@str-ops/shared';

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
