import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import { functionError } from '@/lib/function-error';

import {
  apiKeyListSchema,
  apiKeySchema,
  createdKeySchema,
  type ApiKey,
  type CreatedKey,
  type KeyDraft,
} from './schema';

export type Client = SupabaseClient<Database>;

/** The function that makes a key: the pepper of the key's hash lives there, not in the database. */
export const API_KEYS_FUNCTION = 'api-keys';

type KeyRpcName = 'list_api_keys' | 'update_api_key' | 'revoke_api_key';
type KeyRpc = (
  fn: KeyRpcName,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;

/**
 * The key RPCs, by name.
 *
 * database.types.ts is generated from the local stand, and these functions
 * arrive with 20261028100000: until `npm run db:types` runs on a stand that
 * has it, their names are not in the types. The answers are parsed by zod
 * either way; when the types know them, this cast can go.
 */
function keyRpc(client: Client): KeyRpc {
  return client.rpc.bind(client) as unknown as KeyRpc;
}

/** Null for «every property»; the ids otherwise. */
function propertiesOf(draft: KeyDraft): number[] | null {
  return draft.restrict ? draft.propertyIds : null;
}

/** The company's keys, the newest first — every admin's. */
export async function fetchApiKeys(client: Client): Promise<ApiKey[]> {
  const { data, error } = await keyRpc(client)('list_api_keys');
  if (error) {
    throw error;
  }
  return apiKeyListSchema.parse(data);
}

/**
 * Make a key. The answer carries the key itself — the only time it exists
 * outside its owner's hands — and the stored row.
 */
export async function createApiKey(client: Client, draft: KeyDraft): Promise<CreatedKey> {
  const { data, error } = await client.functions.invoke(API_KEYS_FUNCTION, {
    body: {
      name: draft.name.trim(),
      preset: draft.preset,
      scopes: draft.scopes,
      property_ids: propertiesOf(draft),
      expires_in_days: draft.expiresInDays,
      confirmation: draft.confirmation.trim() === '' ? null : draft.confirmation.trim(),
    },
  });
  if (error) {
    throw await functionError(error);
  }
  return createdKeySchema.parse((data as { data?: unknown } | null)?.data);
}

/** Change what a key may do; it applies to the key's next request and is journalled. */
export async function updateApiKey(client: Client, id: string, draft: KeyDraft): Promise<ApiKey> {
  const { data, error } = await keyRpc(client)('update_api_key', {
    p_id: id,
    p_name: draft.name.trim(),
    p_preset: draft.preset,
    p_scopes: draft.scopes,
    p_property_ids: propertiesOf(draft),
    p_confirmation: draft.confirmation.trim() === '' ? null : draft.confirmation.trim(),
  });
  if (error) {
    throw error;
  }
  return apiKeySchema.parse(data);
}

export async function revokeApiKey(client: Client, id: string): Promise<ApiKey> {
  const { data, error } = await keyRpc(client)('revoke_api_key', { p_id: id });
  if (error) {
    throw error;
  }
  return apiKeySchema.parse(data);
}
