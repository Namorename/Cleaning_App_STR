/**
 * sync-reviews (docs/reviews-to-tasks.md §5): the daily load of guest
 * reviews from Hostaway, 06:00 UTC by pg_cron (the job is created inactive;
 * the owner turns it on). Nothing happens while review_settings.sync_enabled
 * is off. Only GET requests reach Hostaway.
 */

import { readConfig } from "../_shared/env.ts";
import { HostawayClient } from "../_shared/hostaway.ts";
import { createSyncStore, defaultHostId } from "../_shared/reviews/db.ts";
import { HostawayReviewAdapter } from "../_shared/reviews/hostaway.ts";
import { serveJob } from "../_shared/reviews/http.ts";
import { runReviewSync } from "../_shared/reviews/sync.ts";

serveJob("sync-reviews", async (client) => {
  const config = readConfig(Deno.env);
  const hostId = await defaultHostId(client);
  return await runReviewSync({
    store: createSyncStore(client, hostId),
    adapter: new HostawayReviewAdapter(new HostawayClient(config.hostaway)),
  });
});
