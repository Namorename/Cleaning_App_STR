/**
 * «Выполненные» on «Мои» (owner, 2026-10-10): how far back it reaches and how
 * much it reads at a time. The window is one number: the read starts from it
 * and the heading says it (`tasks.done.heading`, by count).
 */
export const DONE_HISTORY_DAYS = 30;

/** Twenty at a time, then «Показать ещё». */
export const DONE_PAGE_SIZE = 20;

/**
 * The first instant the list shows: the start of the day `DONE_HISTORY_DAYS`
 * back, on the phone's clock — so a whole day falls in or out, never half.
 */
export function doneSince(now: Date = new Date()): string {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - DONE_HISTORY_DAYS,
  ).toISOString();
}
