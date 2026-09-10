import type { Json } from '@str-ops/shared';

import { supabase } from '@/lib/supabase';

import {
  catalogItemListSchema,
  supplyRequestListSchema,
  supplyRequestSchema,
  type CatalogItem,
  type SupplyItemPayload,
  type SupplyPriority,
  type SupplyRequest,
} from './schema';

const SUPPLY_COLUMNS =
  'id, requested_by, property_id, task_id, status, priority, note, needed_by, reviewed_at, ' +
  'fulfilled_at, reject_reason, created_at, property:properties(name), ' +
  'items:supply_request_items(id, name, quantity, unit, comment, sort_order, catalog_item_id)';

/** The company's list of consumables she can pick from, in the manager's order. */
export async function fetchSupplyCatalog(): Promise<CatalogItem[]> {
  const { data, error } = await supabase
    .from('supply_catalog_items')
    .select('id, name, name_i18n, unit, sort_order')
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  return catalogItemListSchema.parse(data ?? []);
}

/** Her own requests, newest first. Row level security shows nobody else's. */
export async function fetchMySupplyRequests(): Promise<SupplyRequest[]> {
  const { data, error } = await supabase
    .from('supply_requests')
    .select(SUPPLY_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return supplyRequestListSchema.parse(data ?? []);
}

/** One request, for its own screen. Null when it is not hers to see. */
export async function fetchSupplyRequest(requestId: string): Promise<SupplyRequest | null> {
  const { data, error } = await supabase
    .from('supply_requests')
    .select(SUPPLY_COLUMNS)
    .eq('id', requestId);

  if (error) {
    throw error;
  }

  const rows = supplyRequestListSchema.parse(data ?? []);
  return rows[0] ?? null;
}

export interface SaveSupplyRequestVariables {
  /** Made on the phone: a retry is a replay, a second save is a rewrite. */
  requestId: string;
  items: readonly SupplyItemPayload[];
  priority: SupplyPriority;
  note: string;
  taskId?: string | null;
  propertyId?: number | null;
}

/** Create the request, or rewrite it while it is still new. */
export async function saveSupplyRequest(
  variables: SaveSupplyRequestVariables,
): Promise<SupplyRequest> {
  const { data, error } = await supabase.rpc('save_supply_request', {
    p_id: variables.requestId,
    p_items: variables.items as unknown as Json,
    p_priority: variables.priority,
    p_note: variables.note === '' ? undefined : variables.note,
    p_property_id: variables.propertyId ?? undefined,
    p_task_id: variables.taskId ?? undefined,
  });

  if (error) {
    throw error;
  }

  return supplyRequestSchema.parse(data);
}

/** Withdraw a request nobody has picked up. False when it was already gone. */
export async function deleteSupplyRequest(requestId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_supply_request', { p_id: requestId });

  if (error) {
    throw error;
  }

  return data === true;
}
