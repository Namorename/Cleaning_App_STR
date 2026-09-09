import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import {
  supplyRequestListSchema,
  supplyRequestSchema,
  type SupplyRequest,
  type SupplyStatus,
} from './schema';

export type Client = SupabaseClient<Database>;

const REQUEST_COLUMNS =
  'id, requested_by, property_id, task_id, status, priority, note, needed_by, ' +
  'reviewed_at, fulfilled_at, reject_reason, created_at, ' +
  'property:properties(name), ' +
  'requester:profiles!supply_requests_requested_by_fkey(full_name), ' +
  'items:supply_request_items(id, name, quantity, unit, comment, sort_order)';

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
