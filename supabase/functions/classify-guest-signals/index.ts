/**
 * classify-guest-signals (docs/reviews-to-tasks.md §3.1, §5): the daily
 * reading of the guest reviews whose kept text is unread, 06:20 UTC by
 * pg_cron (the job is created inactive). The model is read only while
 * signal_settings.model_enabled is on for reviews and the function has its
 * key (ANTHROPIC_API_KEY, in the function's secrets — never in the repository
 * or in Vercel); without either, the rules read alone.
 *
 * The function reads no PMS: the provider only says whose reviews it reads
 * and under which provider its runs are journaled. It is written here, not
 * taken from the adapter, so this function does not bundle the Hostaway
 * client; a second PMS passes its own.
 */

import type { StoredProvider } from "../_shared/signals/adapter.ts";
import { AnthropicModelClient } from "../_shared/signals/classify.ts";
import { runReviewClassify } from "../_shared/signals/classify-run.ts";
import { createClassifyStore } from "../_shared/signals/classify-db.ts";
import { defaultHostId } from "../_shared/signals/db.ts";
import { serveJob } from "../_shared/signals/http.ts";

const PROVIDER: StoredProvider = "hostaway";

serveJob("classify-guest-signals", async (client) => {
  const hostId = await defaultHostId(client);
  const key = Deno.env.get("ANTHROPIC_API_KEY")?.trim() ?? "";
  return await runReviewClassify({
    store: createClassifyStore(client, hostId, PROVIDER),
    model: key === "" ? null : new AnthropicModelClient(key),
  });
});
