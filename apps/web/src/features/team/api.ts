import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import { functionError } from '@/lib/function-error';

import {
  cleanerLinkListSchema,
  propertyListSchema,
  staffAccountSchema,
  staffListSchema,
  type AssignmentMode,
  type CleanerLink,
  type Property,
  type Staff,
  type StaffAccount,
  type StaffDraft,
} from './schema';

export type Client = SupabaseClient<Database>;

/** The one door to auth.users. See supabase/functions/manage-staff. */
const MANAGE_STAFF = 'manage-staff';

const STAFF_COLUMNS = 'id, full_name, email, phone, role, preferred_language, is_active, created_at';

/**
 * Everybody in the company, working or not.
 *
 * The switched-off are read too — the section has a tab for them, and a person
 * who left last month is the one whose account a manager comes here to check.
 * Row security keeps it to her own company.
 */
export async function fetchStaff(client: Client): Promise<Staff[]> {
  const { data, error } = await client
    .from('profiles')
    .select(STAFF_COLUMNS)
    .order('full_name', { ascending: true, nullsFirst: false });
  if (error) {
    throw error;
  }
  return staffListSchema.parse(data ?? []);
}

/**
 * Listings a person can be put on.
 *
 * Archived ones are out: opening a listing that has left the company to
 * somebody is a link nobody will ever act on. A flat under maintenance stays —
 * the repair ends and the cleaner is already on it.
 */
export async function fetchProperties(client: Client): Promise<Property[]> {
  const { data, error } = await client
    .from('properties')
    .select('id, name')
    .neq('status', 'archived')
    .order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return propertyListSchema.parse(data ?? []);
}

/**
 * Every link in the company, not one person's.
 *
 * The list shows a count against each name, so the whole set is needed anyway;
 * fetching it once beats a query per row.
 */
export async function fetchCleanerLinks(client: Client): Promise<CleanerLink[]> {
  const { data, error } = await client
    .from('property_cleaners')
    .select('property_id, cleaner_id, mode, priority');
  if (error) {
    throw error;
  }
  return cleanerLinkListSchema.parse(data ?? []);
}

/**
 * Ask the function, and turn its refusal back into something translatable.
 *
 * `invoke` reports a non-2xx as a generic error and leaves the body in
 * `context`; `functionError` reads ours out of it.
 */
async function callManageStaff(
  client: Client,
  body: Record<string, unknown>,
): Promise<StaffAccount> {
  const { data, error } = await client.functions.invoke(MANAGE_STAFF, { body });
  if (error) {
    throw await functionError(error);
  }
  return staffAccountSchema.parse((data as { data?: unknown } | null)?.data);
}

/**
 * Write a person: a new account when the draft has no id, an edit when it has.
 *
 * The address is sent on creation only. Changing where somebody signs in is an
 * auth operation — it wants confirmation on both addresses — and the panel does
 * not pretend otherwise by putting the field in the edit form.
 */
export async function saveStaff(client: Client, draft: StaffDraft): Promise<StaffAccount> {
  const phone = draft.phone.trim();
  const staff = {
    fullName: draft.fullName.trim(),
    phone: phone === '' ? null : phone,
    role: draft.role,
    language: draft.language === '' ? null : draft.language,
  };

  if (draft.id === null) {
    return callManageStaff(client, {
      action: 'create',
      staff: { ...staff, email: draft.email.trim() },
    });
  }

  return callManageStaff(client, {
    action: 'update',
    id: draft.id,
    staff: { ...staff, isActive: draft.isActive },
  });
}

/**
 * A new password for somebody who already has an account.
 *
 * Both buttons in the panel come here. The one in the row is "reset the
 * password"; the one in the dialog is "the letter never arrived, send another".
 * There is no third thing either could do: the current password is stored
 * hashed and cannot be shown again.
 */
export async function resetStaffPassword(client: Client, id: string): Promise<StaffAccount> {
  return callManageStaff(client, { action: 'reset_password', id });
}

export interface LinkInput {
  propertyId: number;
  cleanerId: string;
  mode: AssignmentMode;
  priority: number;
}

/**
 * Put somebody on a listing, or change the terms.
 *
 * Through the RPC rather than a plain write: a listing may have only one
 * automatic cleaner, and the refusal has to name the one who already holds it
 * instead of quoting an index.
 */
export async function saveCleanerLink(client: Client, link: LinkInput): Promise<void> {
  const { error } = await client.rpc('save_property_cleaner', {
    p_property_id: link.propertyId,
    p_cleaner_id: link.cleanerId,
    p_mode: link.mode,
    p_priority: link.priority,
  });
  if (error) {
    throw error;
  }
}

/**
 * Take somebody off a listing.
 *
 * A plain delete under row security — there is nothing to explain about it, so
 * there is no RPC, exactly as with cancelling a task.
 */
export async function removeCleanerLink(
  client: Client,
  propertyId: number,
  cleanerId: string,
): Promise<void> {
  const { error } = await client
    .from('property_cleaners')
    .delete()
    .eq('property_id', propertyId)
    .eq('cleaner_id', cleanerId);
  if (error) {
    throw error;
  }
}
