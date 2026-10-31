/**
 * sync-guest-signals (docs/reviews-to-tasks.md §5, docs/guest-signals.md
 * §2.2): the daily load of guest reviews from the company's PMS through its
 * adapter — Hostaway — 06:00 UTC by pg_cron (the job is created inactive; the
 * owner turns it on). Nothing happens while signal_settings.sync_enabled is
 * off for reviews. Only GET requests reach Hostaway.
 *
 * GUEST_SIGNAL_KEY_SECRET (the functions' secrets, created by the owner at
 * rollout) keys every review as "<provider>:review:<id>"
 * (_shared/signals/key.ts); without it the function refuses to start rather
 * than store a review it could not meet again.
 */

import { readConfig } from "../_shared/env.ts";
import { createSyncStore, defaultHostId, REVIEW_KIND } from "../_shared/signals/db.ts";
import { HostawayAdapter } from "../_shared/signals/hostaway.ts";
import { serveJob } from "../_shared/signals/http.ts";
import { createSignalKeyer, readSignalKeySecret } from "../_shared/signals/key.ts";
import { runReviewSync } from "../_shared/signals/sync.ts";

serveJob("sync-guest-signals", async (client) => {
  const config = readConfig(Deno.env);
  const adapter = new HostawayAdapter(config.hostaway);
  const keyOf = await createSignalKeyer(adapter.provider, REVIEW_KIND, readSignalKeySecret(Deno.env));
  const hostId = await defaultHostId(client);
  return await runReviewSync({
    store: createSyncStore(client, hostId, adapter.provider),
    adapter,
    keyOf,
  });
});
