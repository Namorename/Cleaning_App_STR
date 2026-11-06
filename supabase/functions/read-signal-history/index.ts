/**
 * read-signal-history (docs/property-intelligence-plan.md §4.4): one tick of the
 * reading of past reviews, every ten minutes between 07:00 and 21:50 UTC by
 * pg_cron (the job is created inactive; the owner turns it on). Nothing happens
 * while signal_settings.history_enabled is off, and a tick reads at most one week
 * of reviews and one month of stays. Only GET requests reach Hostaway.
 *
 * The texts are read in memory and leave as labels: this function stores no text
 * and moves no line. GUEST_SIGNAL_KEY_SECRET is read as sync-guest-signals reads
 * it, to find the row a label belongs to; ANTHROPIC_API_KEY is the model's, and
 * without it stays are read and reviews wait.
 */

import { readConfig } from "../_shared/env.ts";
import { defaultHostId, REVIEW_KIND } from "../_shared/signals/db.ts";
import { createHistoryStore } from "../_shared/signals/history-db.ts";
import { runHistory } from "../_shared/signals/history-run.ts";
import { HostawayHistorySource } from "../_shared/signals/hostaway-history.ts";
import { serveJob } from "../_shared/signals/http.ts";
import { createSignalKeyer, readSignalKeySecret } from "../_shared/signals/key.ts";
import { AnthropicThemeClient } from "../_shared/signals/themes-read.ts";

serveJob("read-signal-history", async (client) => {
  const config = readConfig(Deno.env);
  const source = new HostawayHistorySource(config.hostaway);
  const keyOf = await createSignalKeyer(source.provider, REVIEW_KIND, readSignalKeySecret(Deno.env));
  const hostId = await defaultHostId(client);
  const key = Deno.env.get("ANTHROPIC_API_KEY")?.trim() ?? "";
  return await runHistory({
    store: createHistoryStore(client, hostId, source.provider),
    source,
    model: key === "" ? null : new AnthropicThemeClient(key),
    keyOf,
  });
});
