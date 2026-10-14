import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import {
  seriesPointSchema,
  summarySchema,
  TABLE_SCHEMAS,
  type SeriesBucket,
  type SeriesPoint,
  type AnalyticsQuery,
  type AnalyticsRows,
  type AnalyticsTable,
  type ProblemPriority,
  type ProblemStatus,
  type Summary,
  type TablePage,
  type TableSlice,
  type TaskStatus,
} from './schema';

type Client = SupabaseClient<Database>;

/** The server function behind each table (20261015110000). */
const TABLE_FUNCTIONS = {
  cleaningsByProperty: 'analytics_cleanings_by_property',
  cleaningsByCleaner: 'analytics_cleanings_by_cleaner',
  checkoutsByProperty: 'analytics_checkouts_by_property',
  problemsByProperty: 'analytics_problems_by_property',
  problemsByTechnician: 'analytics_problems_by_technician',
} as const satisfies Record<AnalyticsTable, keyof Database['public']['Functions']>;

/** The largest page the server gives; an export reads a table in pages this size. */
export const WHOLE_TABLE_PAGE = 500;
/** An export stops here: 20 000 rows is far beyond any company's year. */
const MAX_EXPORT_PAGES = 40;

interface RpcArgs {
  p_from: string;
  p_to: string;
  p_include_test: boolean;
  p_property_ids?: number[];
  p_assignee_ids?: string[];
  p_task_statuses?: TaskStatus[];
  p_problem_statuses?: ProblemStatus[];
  p_priorities?: ProblemPriority[];
}

/** A list that names nothing is "all": left out, so the server's default (null) holds. */
function some<T>(values: readonly T[]): T[] | undefined {
  return values.length === 0 ? undefined : [...values];
}

/** The arguments every analytics function takes, from one question. */
export function rpcArgs({ period, filters, includeTest }: AnalyticsQuery): RpcArgs {
  const optional = {
    p_property_ids: some(filters.propertyIds),
    p_assignee_ids: some(filters.personIds),
    p_task_statuses: some(filters.taskStatuses),
    p_problem_statuses: some(filters.problemStatuses),
    p_priorities: some(filters.priorities),
  };
  const named = Object.fromEntries(
    Object.entries(optional).filter(([, value]) => value !== undefined),
  ) as Partial<RpcArgs>;
  return { p_from: period.from, p_to: period.to, p_include_test: includeTest, ...named };
}

export async function fetchSummary(client: Client, query: AnalyticsQuery): Promise<Summary> {
  const { data, error } = await client.rpc('analytics_summary', rpcArgs(query));
  if (error) {
    throw error;
  }
  return summarySchema.parse(data);
}

/** The period day by day or week by week, every bucket present. */
export async function fetchSeries(
  client: Client,
  query: AnalyticsQuery,
  bucket: SeriesBucket,
): Promise<SeriesPoint[]> {
  const { data, error } = await client.rpc('analytics_series', {
    ...rpcArgs(query),
    p_bucket: bucket,
  });
  if (error) {
    throw error;
  }
  return seriesPointSchema.array().parse(data ?? []);
}

export async function fetchTablePage<T extends AnalyticsTable>(
  client: Client,
  table: T,
  query: AnalyticsQuery,
  page: TablePage,
): Promise<TableSlice<AnalyticsRows[T]>> {
  const { data, error } = await client.rpc(TABLE_FUNCTIONS[table], {
    ...rpcArgs(query),
    p_limit: page.limit,
    p_offset: page.offset,
  });
  if (error) {
    throw error;
  }
  const rows = TABLE_SCHEMAS[table].array().parse(data ?? []) as AnalyticsRows[T][];
  return { rows, total: rows.length === 0 ? 0 : rows[0].total_count };
}

/** Every row of a table, for an export: page after page until the total is reached. */
export async function fetchWholeTable<T extends AnalyticsTable>(
  client: Client,
  table: T,
  query: AnalyticsQuery,
): Promise<AnalyticsRows[T][]> {
  let rows: AnalyticsRows[T][] = [];
  for (let page = 0; page < MAX_EXPORT_PAGES; page += 1) {
    const slice = await fetchTablePage(client, table, query, {
      limit: WHOLE_TABLE_PAGE,
      offset: page * WHOLE_TABLE_PAGE,
    });
    rows = [...rows, ...slice.rows];
    if (slice.rows.length < WHOLE_TABLE_PAGE || rows.length >= slice.total) {
      break;
    }
  }
  return rows;
}
