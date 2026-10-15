'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import { fetchListings, fetchSeries, fetchSummary, fetchTablePage } from './api';
import { analyticsKeys } from './keys';
import type { AnalyticsQuery, AnalyticsTable, SeriesBucket, TablePage } from './schema';

/**
 * Figures of a closed period do not change; today's change slowly. Five
 * minutes keeps a manager's back-and-forth between periods off the server.
 */
const STALE_MS = 5 * 60 * 1000;

/** The key figures of one period; idle while `query` is null. */
export function useAnalyticsSummary(query: AnalyticsQuery | null) {
  const client = useSupabase();
  return useQuery({
    queryKey: query === null ? analyticsKeys.all : analyticsKeys.summary(query),
    queryFn: () => fetchSummary(client, query as AnalyticsQuery),
    enabled: query !== null,
    staleTime: STALE_MS,
  });
}

/** Every listing for the filter, the archived ones too. */
export function useAnalyticsListings() {
  const client = useSupabase();
  return useQuery({
    queryKey: analyticsKeys.listings(),
    queryFn: () => fetchListings(client),
    staleTime: STALE_MS,
  });
}

/** The period by day or by week, for the charts. */
export function useAnalyticsSeries(query: AnalyticsQuery, bucket: SeriesBucket) {
  const client = useSupabase();
  return useQuery({
    queryKey: analyticsKeys.series(query, bucket),
    queryFn: () => fetchSeries(client, query, bucket),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });
}

/** One page of a table; the page before stays on the screen while the next loads. */
export function useAnalyticsTable<T extends AnalyticsTable>(
  table: T,
  query: AnalyticsQuery,
  page: TablePage,
) {
  const client = useSupabase();
  return useQuery({
    queryKey: analyticsKeys.table(table, query, page),
    queryFn: () => fetchTablePage(client, table, query, page),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });
}
