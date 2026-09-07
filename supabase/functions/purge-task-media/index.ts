/**
 * Retention of task media: remove the files the database says are due.
 *
 * Runs nightly from pg_cron (20260907160200). Asks `task_media_to_purge` for
 * a batch, deletes the objects from the task-media bucket as service_role,
 * and records the rows as purged with `mark_task_media_purged`. Repeats
 * while full batches come back, up to a bound, so a backlog drains over a
 * few nights instead of one endless run.
 *
 * Console output is the function's log in Supabase — deliberate, as in the
 * other functions.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { readSupabaseCredentials } from "../_shared/env.ts";
import { purgeFiles, type PurgeRow } from "../_shared/media-purge.ts";

const BUCKET = "task-media";
const BATCH_SIZE = 200;
const MAX_BATCHES = 10;

interface PurgeSummary {
  batches: number;
  due: number;
  purged: number;
  failures: string[];
  durationMs: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runPurge(): Promise<PurgeSummary> {
  const startedAt = Date.now();
  const { supabaseUrl, supabaseSecretKey } = readSupabaseCredentials(Deno.env);
  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const storage = supabase.storage.from(BUCKET);

  const summary: PurgeSummary = { batches: 0, due: 0, purged: 0, failures: [], durationMs: 0 };

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const { data, error } = await supabase.rpc("task_media_to_purge", { p_limit: BATCH_SIZE });
    if (error) {
      throw new Error(`task_media_to_purge: ${error.message}`);
    }
    const rows = (data ?? []) as PurgeRow[];
    if (rows.length === 0) {
      break;
    }

    summary.batches += 1;
    summary.due += rows.length;

    const outcome = await purgeFiles(rows, storage);
    summary.failures.push(...outcome.failures);

    if (outcome.purgedIds.length > 0) {
      const marked = await supabase.rpc("mark_task_media_purged", { p_ids: outcome.purgedIds });
      if (marked.error) {
        throw new Error(`mark_task_media_purged: ${marked.error.message}`);
      }
      summary.purged += outcome.purgedIds.length;
    }

    // A batch that settled nothing would come back identical: stop rather
    // than loop on the same refusal.
    if (rows.length < BATCH_SIZE || outcome.purgedIds.length === 0) {
      break;
    }
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

Deno.serve(async () => {
  try {
    const summary = await runPurge();
    console.info(
      `Media purge: ${summary.purged} of ${summary.due} due files removed in ${summary.batches} batches` +
        (summary.failures.length > 0 ? `; refused: ${summary.failures.join(" | ")}` : ""),
    );
    return Response.json({ success: true, data: summary });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error(`Media purge failed: ${message}`);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
});
