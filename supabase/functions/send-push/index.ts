/**
 * Sending pushes: the queue of raw.push_outbox, folded, written in each
 * person's language and handed to Expo (docs/f11-plan.md, «Ф»).
 *
 * Called every minute by pg_cron (20260928140000) with the secret key;
 * verify_jwt stays on. The work is in run.ts; this file reads the
 * environment and reports.
 *
 * Secrets: the Supabase pair of every function, and EXPO_ACCESS_TOKEN — the
 * "enhanced security" token of the Expo project (docs/f11-plan.md, 7.6).
 * Without it the push still goes, and the log says it went unsigned.
 *
 * Console output is the function's log in Supabase — deliberate, as in the
 * other functions.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { readSupabaseCredentials } from "../_shared/env.ts";
import { ExpoPushClient } from "./expo.ts";
import { runSendPush } from "./run.ts";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

Deno.serve(async () => {
  try {
    const { supabaseUrl, supabaseSecretKey } = readSupabaseCredentials(Deno.env);
    const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN")?.trim() || null;
    if (accessToken === null) {
      console.warn("send-push: EXPO_ACCESS_TOKEN is not set; pushes go unsigned");
    }

    const summary = await runSendPush(
      createClient(supabaseUrl, supabaseSecretKey),
      new ExpoPushClient({ accessToken }),
      { log: console.info, error: console.error },
    );
    return Response.json(summary);
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("send-push failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
});
