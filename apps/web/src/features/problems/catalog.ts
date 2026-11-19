import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';
import type { CatalogCategory } from '@str-ops/shared/src/problems/categories';
import { z } from 'zod';

import { PROBLEM_PRIORITIES } from './schema';

type Client = SupabaseClient<Database>;

/**
 * How the company names a task (hosts.problem_report_mode, 20261115100000): typed, or picked from
 * its catalogue. A value a newer server spells differently reads as typed — the form of before.
 */
export const REPORT_MODES = ['free_text', 'catalog'] as const;
export type ReportMode = (typeof REPORT_MODES)[number];

const reportModeSchema = z.object({
  problem_report_mode: z.enum(REPORT_MODES).catch('free_text'),
});

/**
 * A category of the company's catalogue, as the phone reads it (its `problemCategorySchema`). The
 * level is shown, never sent as the task's: the server files the task with the category's own.
 * One a newer server spells differently reads as unknown — pickable, without its chip — rather
 * than emptying the list.
 */
export const reportCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  name_i18n: z.record(z.string(), z.string()).catch({}),
  synonyms: z.array(z.string()).catch([]),
  priority: z.enum(PROBLEM_PRIORITIES).nullable().catch(null),
  // The level above high (20261115090000), over priority `high`; absent reads not critical.
  critical: z.boolean().catch(false).optional(),
});

export type ReportCategory = z.infer<typeof reportCategorySchema> & CatalogCategory;

const reportCategoryListSchema = z.array(reportCategorySchema);

/**
 * How long the form waits for an answer before it gives up on the catalogue and takes a typed
 * title: a request that hangs must not hold a task up (owner, 2026-11-20).
 */
export const CATALOG_WAIT_MS = 5_000;

/**
 * The company's way of naming a task. No filter and no id: the read policy on `hosts` answers
 * with the reader's own company (as `fetchHostSettings`). No row reads as typed.
 */
export async function fetchReportMode(client: Client): Promise<ReportMode> {
  const { data, error } = await client
    .from('hosts')
    .select('problem_report_mode')
    .limit(1)
    .abortSignal(AbortSignal.timeout(CATALOG_WAIT_MS))
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? 'free_text' : reportModeSchema.parse(data).problem_report_mode;
}

/**
 * The live categories of the company, in its own order — the phone's read (its
 * `fetchProblemCategories`): the read policy answers with the reader's own company; archived
 * categories are no longer offered.
 */
export async function fetchReportCategories(client: Client): Promise<ReportCategory[]> {
  const { data, error } = await client
    .from('problem_categories')
    .select('id, name, name_i18n, synonyms, priority, critical')
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .abortSignal(AbortSignal.timeout(CATALOG_WAIT_MS));
  if (error) {
    throw error;
  }
  return reportCategoryListSchema.parse(data ?? []);
}

/** What the company names its tasks by: its mode, and the categories when it picks them. */
export interface ReportCatalogData {
  readonly mode: ReportMode;
  readonly categories: readonly ReportCategory[];
}

/** The catalogue is read only by a company that reports by it: a typed company asks once. */
export async function fetchReportCatalog(client: Client): Promise<ReportCatalogData> {
  const mode = await fetchReportMode(client);
  if (mode !== 'catalog') {
    return { mode, categories: [] };
  }
  return { mode, categories: await fetchReportCategories(client) };
}

/**
 * What the form of «Новое задание» asks for the task's name:
 * - `catalog`: a category of the list, which then names the task and sets its urgency;
 * - `free`: a typed title and a chosen urgency, the form of before — for a company that types,
 *   and for one whose catalogue could not be read or is empty: a task is never held up by it;
 * - `pending`: not known yet.
 */
export type ReportCatalog =
  | { readonly kind: 'pending' }
  | { readonly kind: 'catalog'; readonly categories: readonly ReportCategory[] }
  | { readonly kind: 'free' };

/**
 * The form's answer from the query's. Rows read once count over a later failure: a refetch that
 * fails keeps them, and the form does not change under the manager's hands.
 */
export function reportCatalogOf(query: {
  data: ReportCatalogData | undefined;
  isError: boolean;
}): ReportCatalog {
  const { data } = query;
  if (data === undefined) {
    return query.isError ? { kind: 'free' } : { kind: 'pending' };
  }
  return data.mode === 'catalog' && data.categories.length > 0
    ? { kind: 'catalog', categories: data.categories }
    : { kind: 'free' };
}
