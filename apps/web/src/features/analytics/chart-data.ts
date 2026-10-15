import { Constants, type Language } from '@str-ops/shared';

import { formatNumber, personLabel } from './format';
import type { Translate } from './kpi-spec';
import { periodDays, type Period } from './period';
import type {
  AnalyticsFilters,
  AnalyticsQuery,
  AnalyticsRows,
  NameMode,
  SeriesBucket,
  Summary,
  TablePage,
} from './schema';

/**
 * What the Analytics charts draw, apart from the drawing: the page's charts
 * and the PDF's read the same queries and make the same bars of them.
 */

/** Longer than this, the columns are weeks: a day apiece would be too thin to click. */
export const DAYS_BY_DAY = 60;
/** The bars of a "by listing" or "by cleaner" chart: the busiest, the table has the rest. */
export const TOP_BARS = 8;
/** The page of a table the busiest bars come from. */
export const TOP_PAGE: TablePage = { limit: TOP_BARS, offset: 0 };

/** One bar: what it is, how long it is and how its figure is written. */
export interface BarDatum {
  id: string;
  label: string;
  value: number;
  valueText: string;
}

export function seriesBucket(period: Period): SeriesBucket {
  return periodDays(period) > DAYS_BY_DAY ? 'week' : 'day';
}

/** The query with some filters lifted. */
function without(query: AnalyticsQuery, part: Partial<AnalyticsFilters>): AnalyticsQuery {
  return { ...query, filters: { ...query.filters, ...part } };
}

/** A bar list is not filtered by its own bars: the others stay to be added (the cross-filter). */
export function chartQueries(query: AnalyticsQuery): {
  byListing: AnalyticsQuery;
  byCleaner: AnalyticsQuery;
  byUrgency: AnalyticsQuery;
} {
  return {
    byListing: without(query, { propertyIds: [] }),
    byCleaner: without(query, { personIds: [] }),
    byUrgency: without(query, { priorities: [] }),
  };
}

export function listingBars(
  rows: readonly AnalyticsRows['cleaningsByProperty'][],
  language: Language,
): BarDatum[] {
  return rows
    .filter((row) => row.done > 0)
    .map((row) => ({
      id: String(row.listing_id),
      label: row.listing_name,
      value: row.done,
      valueText: formatNumber(row.done, language),
    }));
}

export function cleanerBars(
  rows: readonly AnalyticsRows['cleaningsByCleaner'][],
  names: NameMode,
  language: Language,
): BarDatum[] {
  return rows
    .filter((row) => row.done > 0)
    .map((row) => ({
      id: row.person_id,
      label: personLabel(row.full_name, names),
      value: row.done,
      valueText: formatNumber(row.done, language),
    }));
}

/** The urgency bars read the page's own figures unless urgency itself is filtered. */
export function urgencySummary(
  filters: AnalyticsFilters,
  summary: Summary | undefined,
  byUrgency: Summary | undefined,
): Summary | undefined {
  return filters.priorities.length === 0 ? summary : byUrgency;
}

/** The tasks created by urgency, low to high. */
export function urgencyBars(summary: Summary | undefined, t: Translate, language: Language): BarDatum[] {
  if (summary === undefined) {
    return [];
  }
  return Constants.public.Enums.problem_priority.map((priority) => ({
    id: priority,
    label: t(`problems.priorities.${priority}`),
    value: summary.problems_by_priority[priority],
    valueText: formatNumber(summary.problems_by_priority[priority], language),
  }));
}
