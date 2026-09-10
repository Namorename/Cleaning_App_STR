import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import { FALLBACK_LANGUAGE, isSupportedLanguage, type Language } from '@str-ops/shared';

import {
  catalogItemListSchema,
  catalogItemSchema,
  supplyRequestListSchema,
  supplyRequestSchema,
  trimTranslations,
  type CatalogItem,
  type CatalogItemDraft,
  type SupplyRequest,
  type SupplyStatus,
} from './schema';

export type Client = SupabaseClient<Database>;

const REQUEST_COLUMNS =
  'id, requested_by, property_id, task_id, status, priority, note, needed_by, ' +
  'reviewed_at, fulfilled_at, reject_reason, created_at, ' +
  'property:properties(name), ' +
  'requester:profiles!supply_requests_requested_by_fkey(full_name), ' +
  'items:supply_request_items(id, name, quantity, unit, comment, sort_order, catalog_item_id)';

const CATALOG_COLUMNS = 'id, name, name_i18n, unit, sort_order, archived_at';

/** The whole catalogue, archived entries included, in the order the manager keeps it. */
export async function fetchCatalog(client: Client): Promise<CatalogItem[]> {
  const { data, error } = await client
    .from('supply_catalog_items')
    .select(CATALOG_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return catalogItemListSchema.parse(data ?? []);
}

/** The language the company writes its names in; row level security shows one company. */
export async function fetchCompanyLanguage(client: Client): Promise<Language> {
  const { data, error } = await client.from('hosts').select('default_language').limit(1).maybeSingle();
  if (error) {
    throw error;
  }
  const code = data?.default_language ?? '';
  return isSupportedLanguage(code) ? code : FALLBACK_LANGUAGE;
}

export async function saveCatalogItem(client: Client, draft: CatalogItemDraft): Promise<CatalogItem> {
  const { data, error } = await client.rpc('save_supply_catalog_item', {
    p_id: draft.id,
    p_name: draft.name.trim(),
    p_name_i18n: trimTranslations(draft.name_i18n),
    p_unit: draft.unit,
  });
  if (error) {
    throw error;
  }
  return catalogItemSchema.parse(data);
}

/** Off the phone's list, or back on it. */
export async function archiveCatalogItem(
  client: Client,
  itemId: string,
  archived: boolean,
): Promise<CatalogItem> {
  const { data, error } = await client.rpc('archive_supply_catalog_item', {
    p_id: itemId,
    p_archived: archived,
  });
  if (error) {
    throw error;
  }
  return catalogItemSchema.parse(data);
}

/** Every request of the company, newest first. Row level security draws the line. */
export async function fetchSupplyRequests(client: Client): Promise<SupplyRequest[]> {
  const { data, error } = await client
    .from('supply_requests')
    .select(REQUEST_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) {
    throw error;
  }
  return supplyRequestListSchema.parse(data ?? []);
}

export interface ReviewVariables {
  requestId: string;
  status: SupplyStatus;
  /** Required by the server when the status is 'rejected'. */
  rejectReason?: string;
}

/** Move a request along, or reject it with a reason. The server checks the path. */
export async function reviewSupplyRequest(
  client: Client,
  variables: ReviewVariables,
): Promise<SupplyRequest> {
  const reason = variables.rejectReason?.trim() ?? '';
  const { data, error } = await client.rpc('review_supply_request', {
    p_id: variables.requestId,
    p_status: variables.status,
    p_reject_reason: reason === '' ? undefined : reason,
  });
  if (error) {
    throw error;
  }
  return supplyRequestSchema.parse(data);
}
