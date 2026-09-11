import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import { functionError } from '@/lib/function-error';

import {
  propertyListSchema,
  syncSummarySchema,
  type Property,
  type PropertyStatus,
  type SyncSummary,
} from './schema';

export type Client = SupabaseClient<Database>;

const PROPERTY_COLUMNS = 'id, name, address, city, status, parent_id, bedrooms, max_guests';

/** The statuses a cleaning is in while nobody has started it yet. */
const NOT_STARTED = ['unassigned', 'assigned'] as const;

/**
 * Every listing the company has, archived ones included.
 *
 * This is the one read in the panel that does not hide the archive, and it is
 * deliberate: the registry is where an archived listing is brought back from,
 * so it has to be able to see one. The tab keeps it out of the default view.
 *
 * Everywhere else asks for `status <> 'archived'`. If you are copying this
 * function into a new screen, that is what you want instead — an archived
 * listing in a picker is the bug this whole state exists to prevent.
 */
export async function fetchRegistry(client: Client): Promise<Property[]> {
  const { data, error } = await client
    .from('properties')
    .select(PROPERTY_COLUMNS)
    .order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return propertyListSchema.parse(data ?? []);
}

/**
 * Cleanings nobody has started, for the whole company in one query.
 *
 * One read rather than one per row: the registry shows the number against
 * every listing and adds them up for a bulk action, so it needs the lot
 * anyway. Row security keeps it to the manager's own company.
 */
export async function fetchOpenCleanings(client: Client): Promise<{ property_id: number }[]> {
  const { data, error } = await client
    .from('tasks')
    .select('property_id')
    .eq('type', 'cleaning')
    .in('status', NOT_STARTED);
  if (error) {
    throw error;
  }
  return (data ?? []) as { property_id: number }[];
}

/**
 * The same count, read fresh for one listing.
 *
 * Asked at the moment the confirmation opens rather than taken off the list:
 * the number in a dialog that is about to cancel work should be the number as
 * it is now, not as it was when the page loaded.
 */
export async function countOpenCleanings(client: Client, propertyId: number): Promise<number> {
  const { data, error } = await client.rpc('property_open_cleanings', {
    p_property_id: propertyId,
  });
  if (error) {
    throw error;
  }
  return data ?? 0;
}

export interface StatusChange {
  propertyId: number;
  status: PropertyStatus;
  /** The manager has been told how many cleanings this sweeps and said yes. */
  cancelTasks?: boolean;
}

/**
 * Take a listing out of service, or put it back.
 *
 * Through the RPC rather than a write to the column: the status and the
 * cleanings it invalidates have to move together, and the refusal that names
 * how many are at stake is raised there.
 */
export async function setPropertyStatus(client: Client, change: StatusChange): Promise<void> {
  const { error } = await client.rpc('set_property_status', {
    p_property_id: change.propertyId,
    p_status: change.status,
    p_cancel_tasks: change.cancelTasks ?? false,
  });
  if (error) {
    throw error;
  }
}

/**
 * Pull the listings from Hostaway now, instead of waiting for the night.
 *
 * A flat added in Hostaway this morning is wanted in the panel this morning.
 * The function answers with what it did — added, updated, and anything it
 * could not read — and the panel shows all three: a sync that quietly skipped
 * a listing is worse than one that failed outright.
 */
export async function syncListings(client: Client): Promise<SyncSummary> {
  const { data, error } = await client.functions.invoke('sync-listings', { body: {} });
  if (error) {
    throw await functionError(error);
  }
  return syncSummarySchema.parse((data as { data?: unknown } | null)?.data);
}
