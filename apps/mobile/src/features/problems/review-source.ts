import type { TFunction } from 'i18next';

/**
 * Tasks from guest reviews on the phone (docs/reviews-to-tasks.md §2.7, §4.5),
 * behind one switch.
 *
 * Off until migration 20261017110000 is in the cloud: a select of a column the
 * server does not have answers 42703 and empties the screen, so while this is
 * false the phone asks for nothing new and shows nothing new. The OTA that
 * follows the migration turns it on; review_settings.tasks_enabled goes on
 * only after that OTA has reached the phones (docs §7).
 */
export const REVIEW_SOURCE_ENABLED = false;

/** The columns a task from a review adds to a select, or nothing while the switch is off. */
export const REVIEW_SOURCE_COLUMNS = REVIEW_SOURCE_ENABLED
  ? 'source, title_i18n, review_facts, '
  : '';

/** What a technician may know of the review: never a quote (the owner's decision 3). */
export interface ReviewFacts {
  readonly kind: string;
  readonly subject: string;
  readonly channel: string | null;
  readonly departure_month: string | null;
}

export interface ReviewSourced {
  readonly title: string;
  /** Absent from a build that does not ask for it (the switch off) and from older saved copies. */
  readonly source?: 'staff' | 'review';
  readonly title_i18n?: Readonly<Record<string, string>> | null;
  readonly review_facts?: ReviewFacts | null;
}

/** The title in the reader's language when the task has it, else as written. */
export function shownTitle(problem: ReviewSourced, language: string): string {
  return problem.title_i18n?.[language] ?? problem.title;
}

/** «Из отзыва гостя · Гость выехал: 2026-10», or null for a task somebody reported. */
export function reviewLabel(problem: ReviewSourced, t: TFunction): string | null {
  if (problem.source !== 'review') {
    return null;
  }
  const month = problem.review_facts?.departure_month;
  return month
    ? `${t('problems.source.review')} · ${t('problems.source.reviewLeft', { month })}`
    : t('problems.source.review');
}
