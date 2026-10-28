/**
 * The public API v1, wired to Supabase (docs/api-v1.md).
 *
 * The rules live in handler.ts and in the database's api_v1_* functions; this
 * file is the plumbing: the service-role client the functions are called with,
 * the pepper the keys are hashed with, and the platform's background queue for
 * the request log.
 *
 * verify_jwt is off (supabase/config.toml): an API key is not a Supabase token,
 * and the handler checks the key itself before anything else.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

import { readPepper } from "../_shared/api-key.ts";
import { readSupabaseCredentials } from "../_shared/env.ts";
import { type ApiDeps, createApiHandler, type RpcResult } from "./handler.ts";

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

/** A stalled database call must not hold the worker to the platform's limit. */
const RPC_TIMEOUT_MS = 10_000;

/**
 * Built once per cold start. A missing secret is a deployment mistake: the
 * handler then answers 500 with the reason in the log, rather than the module
 * failing to load and leaving nothing to read.
 */
function buildDeps(): ApiDeps {
  const pepper = readPepper(Deno.env);
  try {
    const { supabaseUrl, supabaseSecretKey } = readSupabaseCredentials(Deno.env);
    const client = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      pepper,
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
    console.error(`api: ${error instanceof Error ? error.message : "configuration error"}`);
    return {
      pepper: null,
      rpc: () => Promise.resolve({ data: null, error: { code: "config", message: "not configured" } }),
    };
  }
}

Deno.serve(createApiHandler(buildDeps()));
