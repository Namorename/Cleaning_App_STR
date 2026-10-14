import type { AnalyticsQuery, AnalyticsTable, SeriesBucket, TablePage } from './schema';

/** Query keys for everything the Analytics page reads. */
export const analyticsKeys = {
  all: ['analytics'] as const,
  summary: (query: AnalyticsQuery) => ['analytics', 'summary', query] as const,
  table: (table: AnalyticsTable, query: AnalyticsQuery, page: TablePage) =>
    ['analytics', 'table', table, query, page] as const,
  series: (query: AnalyticsQuery, bucket: SeriesBucket) =>
    ['analytics', 'series', query, bucket] as const,
};
