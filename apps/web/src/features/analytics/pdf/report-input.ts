import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Language } from '@str-ops/shared';

import { fetchSeries, fetchSummary, fetchTablePage, fetchWholeTable } from '../api';
import { chartQueries, seriesBucket, TOP_PAGE, urgencySummary } from '../chart-data';
import type { Translate } from '../kpi-spec';
import type { Period } from '../period';
import type { AnalyticsFilters, AnalyticsQuery, NameMode } from '../schema';
import type { ReportInput, ReportLookups, ReportTables } from './report-model';

/** The page as it is when the button is pressed. */
export interface PdfRequest {
  client: SupabaseClient<Database>;
  period: Period;
  /** The period compared with; null when the comparison is off. */
  previous: Period | null;
  filters: AnalyticsFilters;
  names: NameMode;
  language: Language;
  t: Translate;
  lookups: ReportLookups;
}

async function readTables(client: SupabaseClient<Database>, query: AnalyticsQuery): Promise<ReportTables> {
  const [cleaningsByProperty, cleaningsByCleaner, checkoutsByProperty, problemsByProperty, problemsByTechnician] =
    await Promise.all([
      fetchWholeTable(client, 'cleaningsByProperty', query),
      fetchWholeTable(client, 'cleaningsByCleaner', query),
      fetchWholeTable(client, 'checkoutsByProperty', query),
      fetchWholeTable(client, 'problemsByProperty', query),
      fetchWholeTable(client, 'problemsByTechnician', query),
    ]);
  return { cleaningsByProperty, cleaningsByCleaner, checkoutsByProperty, problemsByProperty, problemsByTechnician };
}

/**
 * Everything the report needs, read through the page's own functions under the
 * manager's own session — the same answers the screen is drawn from, every row
 * of every table. Demo and test listings never go into a report (owner,
 * 2026-10-15), whatever the local stand's switch says.
 */
export async function readReportInput(request: PdfRequest, now: Date): Promise<ReportInput> {
  const { client, period, previous, filters } = request;
  const query: AnalyticsQuery = { period, filters, includeTest: false };
  const bucket = seriesBucket(period);
  const bars = chartQueries(query);

  const [summary, previousSummary, series, byListing, byCleaner, byUrgency, tables] = await Promise.all([
    fetchSummary(client, query),
    previous === null ? Promise.resolve(null) : fetchSummary(client, { ...query, period: previous }),
    fetchSeries(client, query, bucket),
    fetchTablePage(client, 'cleaningsByProperty', bars.byListing, TOP_PAGE),
    fetchTablePage(client, 'cleaningsByCleaner', bars.byCleaner, TOP_PAGE),
    // Read only when urgency is filtered: otherwise the bars are the period's own figures.
    filters.priorities.length === 0 ? Promise.resolve(undefined) : fetchSummary(client, bars.byUrgency),
    readTables(client, query),
  ]);

  return {
    language: request.language,
    t: request.t,
    period,
    previous,
    bucket,
    filters,
    names: request.names,
    lookups: request.lookups,
    summary,
    previousSummary,
    series,
    bars: {
      byListing: byListing.rows,
      byCleaner: byCleaner.rows,
      urgency: urgencySummary(filters, summary, byUrgency),
    },
    tables,
    generatedAt: now,
  };
}
