import { Constants, type Language } from '@str-ops/shared';

import { listingFilterLabel, personFilterLabel, type FilterLookups } from './filter-labels';
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

type ListingRow = AnalyticsRows['cleaningsByProperty'];
type CleanerRow = AnalyticsRows['cleaningsByCleaner'];

function listingBar(row: ListingRow, language: Language): BarDatum {
  return {
    id: String(row.listing_id),
    label: row.listing_name,
    value: row.done,
    valueText: formatNumber(row.done, language),
  };
}

function cleanerBar(row: CleanerRow, names: NameMode, language: Language): BarDatum {
  return {
    id: row.person_id,
    label: personLabel(row.full_name, names),
    value: row.done,
    valueText: formatNumber(row.done, language),
  };
}

export function listingBars(rows: readonly ListingRow[], language: Language): BarDatum[] {
  return rows.filter((row) => row.done > 0).map((row) => listingBar(row, language));
}

export function cleanerBars(rows: readonly CleanerRow[], names: NameMode, language: Language): BarDatum[] {
  return rows.filter((row) => row.done > 0).map((row) => cleanerBar(row, names, language));
}

/** The picks the rows do not hold: theirs are read apart, with the page's own filter. */
export function picksOutside(picked: readonly string[], rowIds: readonly string[]): string[] {
  return picked.filter((id) => !rowIds.includes(id));
}

/**
 * A bar for each pick the busiest bars leave out (owner, 2026-10-16): the
 * bar the page is filtered to is always in sight, marked, the rest dimmed.
 * Its figure comes from its own row — nought when it did nothing — and with
 * no row at all it is named as its chip names it.
 */
function picksBeyond(
  shown: readonly BarDatum[],
  picked: readonly string[],
  own: readonly BarDatum[],
  chipLabel: (id: string) => string,
  language: Language,
): BarDatum[] {
  if (picked.length === 0) {
    return [];
  }
  return picksOutside(
    picked,
    shown.map((bar) => bar.id),
  ).map(
    (id) =>
      own.find((bar) => bar.id === id) ?? { id, label: chipLabel(id), value: 0, valueText: formatNumber(0, language) },
  );
}

/** The listings picked beyond the busiest, from rows read with the page's filter. */
export function pickedListingBars(
  shown: readonly BarDatum[],
  picked: readonly number[],
  rows: readonly ListingRow[],
  listingNames: FilterLookups['listingNames'],
  language: Language,
): BarDatum[] {
  return picksBeyond(
    shown,
    picked.map(String),
    rows.map((row) => listingBar(row, language)),
    (id) => listingFilterLabel(Number(id), listingNames),
    language,
  );
}

/** The cleaners picked beyond the busiest, from rows read with the page's filter. */
export function pickedCleanerBars(
  shown: readonly BarDatum[],
  picked: readonly string[],
  rows: readonly CleanerRow[],
  names: NameMode,
  lookups: Pick<FilterLookups, 'people' | 'staff'>,
  t: Translate,
  language: Language,
): BarDatum[] {
  return picksBeyond(
    shown,
    picked,
    rows.map((row) => cleanerBar(row, names, language)),
    (id) => personFilterLabel(id, lookups.people, lookups.staff, t),
    language,
  );
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
