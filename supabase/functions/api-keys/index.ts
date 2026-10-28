/**
 * Issuing API keys, wired to Supabase. The rules are in handler.ts and in
 * create_api_key; this file is the plumbing.
 *
 * verify_jwt is off (supabase/config.toml), for the reason manage-staff gives:
 * a browser preflight carries no Authorization header. The token is checked
 * here, against Auth, before anything is made.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

import { readPepper } from "../_shared/api-key.ts";
import { readSupabaseCredentials } from "../_shared/env.ts";
import { createKeysHandler, type KeysDeps } from "./handler.ts";

function buildDeps(): KeysDeps {
  const pepper = readPepper(Deno.env);
  const { supabaseUrl, supabaseSecretKey } = readSupabaseCredentials(Deno.env);
  const admin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    pepper,
    userIdOf: async (token) => {
      const { data, error } = await admin.auth.getUser(token);
      return error !== null || data.user === null ? null : data.user.id;
    },
    createKey: async (record) => {
      const { data, error } = await admin.rpc("create_api_key", {
        p_actor: record.actorId,
        p_name: record.name,
        p_prefix: record.prefix,
        p_digest: record.digest,
        p_preset: record.preset,
        p_scopes: record.scopes,
        p_property_ids: record.propertyIds,
        p_expires_at: record.expiresAt,
        p_confirmation: record.confirmation,
      });
      return { data, error };
    },
  };
}

Deno.serve(createKeysHandler(buildDeps()));
