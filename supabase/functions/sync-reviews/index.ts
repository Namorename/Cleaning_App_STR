/**
 * sync-reviews (docs/reviews-to-tasks.md §5): the daily load of guest
 * reviews from Hostaway, 06:00 UTC by pg_cron (the job is created inactive;
 * the owner turns it on). Nothing happens while review_settings.sync_enabled
 * is off. Only GET requests reach Hostaway.
 *
 * REVIEW_ID_HMAC_SECRET (the function's secrets, created by the owner at
 * rollout) keys every review (_shared/reviews/key.ts); without it the
 * function refuses to start rather than store a review it could not meet
 * again.
 */

import { readConfig } from "../_shared/env.ts";
import { HostawayClient } from "../_shared/hostaway.ts";
import { createSyncStore, defaultHostId, SOURCE } from "../_shared/reviews/db.ts";
import { HostawayReviewAdapter } from "../_shared/reviews/hostaway.ts";
import { serveJob } from "../_shared/reviews/http.ts";
import { createReviewKeyer, readReviewIdSecret } from "../_shared/reviews/key.ts";
import { runReviewSync } from "../_shared/reviews/sync.ts";

serveJob("sync-reviews", async (client) => {
  const config = readConfig(Deno.env);
  const keyOf = await createReviewKeyer(SOURCE, readReviewIdSecret(Deno.env));
  const hostId = await defaultHostId(client);
  return await runReviewSync({
    store: createSyncStore(client, hostId),
    adapter: new HostawayReviewAdapter(new HostawayClient(config.hostaway)),
    keyOf,
  });
});
