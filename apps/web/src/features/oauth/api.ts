import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';
import { z } from 'zod';

import type { KeyDraft } from '@/features/api-keys/schema';

import type { ConsentRequest } from './authorize-request';
import type { OAuthClient } from './client-metadata';

export type Client = SupabaseClient<Database>;

const DAY_MS = 86_400_000;

type OAuthRpc = (
  fn: 'oauth_authorize' | 'oauth_client',
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;

/** As keyRpc in api-keys: the generated types call nullable arguments non-null. */
function oauthRpc(client: Client): OAuthRpc {
  return client.rpc.bind(client) as unknown as OAuthRpc;
}

const codeSchema = z.object({ code: z.string().regex(/^woomcd_[0-9a-f]{64}$/) });

const registeredSchema = z.object({
  client_id: z.string(),
  client_name: z.string().nullable(),
  redirect_uris: z.array(z.string()),
});

/** A client registered with us dynamically; null when there is none by that id. */
export async function fetchRegisteredClient(
  client: Client,
  clientId: string,
): Promise<OAuthClient | null> {
  const { data, error } = await oauthRpc(client)('oauth_client', { p_client_id: clientId });
  if (error) {
    throw error;
  }
  if (data === null) {
    return null;
  }
  const row = registeredSchema.parse(data);
  return { id: row.client_id, name: row.client_name, redirectUris: row.redirect_uris };
}

/**
 * The admin's «Allow»: what the connection may do, recorded by the database
 * with a code the client trades for tokens within ten minutes.
 */
export async function approveConnection(
  client: Client,
  request: ConsentRequest,
  draft: KeyDraft,
  now: number = Date.now(),
): Promise<string> {
  const { data, error } = await oauthRpc(client)('oauth_authorize', {
    p_client_id: request.clientId,
    p_client_name: request.clientName,
    p_redirect_uri: request.redirectUri,
    p_code_challenge: request.codeChallenge,
    p_resource: request.resource,
    p_name: draft.name.trim(),
    p_preset: draft.preset,
    p_scopes: draft.scopes,
    p_property_ids: draft.restrict ? draft.propertyIds : null,
    p_expires_at:
      draft.expiresInDays === null
        ? null
        : new Date(now + draft.expiresInDays * DAY_MS).toISOString(),
  });
  if (error) {
    throw error;
  }
  return codeSchema.parse(data).code;
}
