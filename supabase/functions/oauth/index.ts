/**
 * The authorization server's token and registration endpoints, wired to
 * Supabase (docs/mcp-oauth.md). The rules are in handler.ts and in the
 * oauth_* database functions; this file is the plumbing.
 *
 * verify_jwt is off (supabase/config.toml): an OAuth client holds no Supabase
 * token, and a browser preflight carries no Authorization header.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

import { readPepper } from "../_shared/api-key.ts";
import { readSupabaseCredentials } from "../_shared/env.ts";
import { readOAuthConfig } from "../_shared/mcp-oauth.ts";
import { createOAuthHandler, type OAuthDeps, type RpcResult } from "./handler.ts";

/** Claude waits ten seconds for the token endpoint: a stalled call must answer sooner. */
const RPC_TIMEOUT_MS = 8_000;

function buildDeps(): OAuthDeps {
  const pepper = readPepper(Deno.env);
  try {
    const { supabaseUrl, supabaseSecretKey } = readSupabaseCredentials(Deno.env);
    const client = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      pepper,
      resource: readOAuthConfig(Deno.env, supabaseUrl).resource,
      rpc: async (fn, args): Promise<RpcResult> => {
        const { data, error } = await client.rpc(fn, args).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
        return { data, error };
      },
    };
  } catch (error) {
    console.error(`oauth: ${error instanceof Error ? error.message : "configuration error"}`);
    return {
      pepper: null,
      resource: "",
      rpc: () => Promise.resolve({ data: null, error: { code: "config" } }),
    };
  }
}

Deno.serve(createOAuthHandler(buildDeps()));
