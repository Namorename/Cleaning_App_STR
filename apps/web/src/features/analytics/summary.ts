import type { Summary } from './schema';

/** Nothing was counted: no cleaning, checkout, night or task in the period, nor a cancelled one. */
export function isEmptySummary(summary: Summary): boolean {
  return (
    summary.cleanings_done === 0 &&
    summary.cleanings_planned === 0 &&
    summary.checkouts === 0 &&
    summary.occupied_nights === 0 &&
    summary.problems_created === 0 &&
    summary.problems_resolved === 0 &&
    summary.problems_open === 0 &&
    summary.problems_cancelled === 0
  );
}
