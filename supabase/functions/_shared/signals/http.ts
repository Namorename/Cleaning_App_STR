/**
 * The door of the guest-signal jobs (sync-guest-signals,
 * classify-guest-signals): the scheduler (pg_cron with the service key) or a
 * manager may start one; anybody else gets 403 before anything is read. Edge
 * Functions log to the console — that is their journal — so console.info and
 * console.error are used on purpose, under the job's name; nothing from a
 * signal is ever written there, only counts and codes.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { allowsSync, CORS_HEADERS, readBearer } from "../caller.ts";
import { ConfigError, readSupabaseCredentials } from "../env.ts";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function serviceClient(): SupabaseClient {
  const { supabaseUrl, supabaseSecretKey } = readSupabaseCredentials(Deno.env);
  return createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false } });
}

/** The role in a user's token, from app_metadata (never user_metadata), or null. */
async function roleOf(token: string): Promise<string | null> {
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error !== null || data.user === null) {
    return null;
  }
  const role = (data.user.app_metadata as { role?: unknown } | null)?.role;
  return typeof role === "string" ? role : null;
}

/** Serves one job: `run` gets a service-role client and returns its summary. */
export function serveJob(name: string, run: (client: SupabaseClient) => Promise<unknown>): void {
  Deno.serve(async (request: Request) => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const allowed = await allowsSync({
        token: readBearer(request),
        serviceKey: readSupabaseCredentials(Deno.env).supabaseSecretKey,
        roleOf,
      });
      if (!allowed) {
        console.error(`${name} refused: the caller is neither the scheduler nor a manager`);
        return Response.json(
          { success: false, error: `Not allowed to start ${name}` },
          { status: 403, headers: CORS_HEADERS },
        );
      }

      const startedAt = Date.now();
      const summary = await run(serviceClient());
      console.info(`${name} finished in ${Date.now() - startedAt} ms: ${JSON.stringify(summary)}`);
      return Response.json({ success: true, data: summary }, { headers: CORS_HEADERS });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      console.error(`${name} failed: ${message}`);
      // Missing settings are the deployment's fault, not the request's.
      const status = error instanceof ConfigError ? 500 : 502;
      return Response.json({ success: false, error: message }, { status, headers: CORS_HEADERS });
    }
  });
}
