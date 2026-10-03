import type { Language } from '@str-ops/shared';

import type { TaskStep } from './schema';

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
