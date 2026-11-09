/**
 * The MCP server, wired to Supabase (docs/mcp-server.md).
 *
 * The rules live in handler.ts and tools.ts, and under them in the API's own
 * handler, which this function bundles from ../api: the same service-role
 * client, the same pepper, the same database functions and request log as
 * the api function. A change under supabase/functions/api/ is therefore a
 * redeploy of mcp as well (docs/mcp-server.md §7).
 *
 * verify_jwt is off (supabase/config.toml): an API key is not a Supabase token.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

import { readPepper } from "../_shared/api-key.ts";
import { readSupabaseCredentials } from "../_shared/env.ts";
import { type OAuthConfig, readOAuthConfig } from "../_shared/mcp-oauth.ts";
import { type ApiDeps, createApiHandler, type RpcResult } from "../api/handler.ts";
import { createMcpHandler } from "./handler.ts";

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

/** A stalled database call must not hold the worker to the platform's limit (as in api). */
const RPC_TIMEOUT_MS = 10_000;

/**
 * As api/index.ts builds it: a missing secret answers 500 with the reason in
 * the log. A copy, not a shared module: moving it out of api/index.ts would
 * make this step a redeploy of api as well; when api changes next, both take
 * it from _shared/ (docs/mcp-server.md §7).
 */
function buildApiDeps(): ApiDeps {
  const pepper = readPepper(Deno.env);
  try {
    const { supabaseUrl, supabaseSecretKey } = readSupabaseCredentials(Deno.env);
    const client = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      pepper,
      // The MCP server takes OAuth access tokens as well as keys (docs/mcp-oauth.md).
      channel: "mcp",
      rpc: async (fn, args): Promise<RpcResult> => {
        const { data, error } = await client.rpc(fn, args).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
        return { data, error };
      },
      defer: (work) => {
        const guarded = work.catch(() => undefined);
        if (typeof EdgeRuntime !== "undefined") {
          EdgeRuntime.waitUntil(guarded);
        }
      },
    };
  } catch (error) {
    console.error(`mcp: ${error instanceof Error ? error.message : "configuration error"}`);
    return {
      pepper: null,
      rpc: () => Promise.resolve({ data: null, error: { code: "config", message: "not configured" } }),
    };
  }
}

/** Where clients sign in (docs/mcp-oauth.md); without the project's URL, keys only. */
function oauthConfig(): OAuthConfig | undefined {
  try {
    return readOAuthConfig(Deno.env, readSupabaseCredentials(Deno.env).supabaseUrl);
  } catch {
    return undefined;
  }
}

const api = createApiHandler(buildApiDeps());
Deno.serve(createMcpHandler({ api, oauth: oauthConfig() }));
