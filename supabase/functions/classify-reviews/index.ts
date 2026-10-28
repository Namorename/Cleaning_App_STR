/**
 * classify-reviews (docs/reviews-to-tasks.md §3.1, §5): the daily reading of
 * the reviews whose kept text is unread, 06:20 UTC by pg_cron (the job is
 * created inactive). The model is read only while
 * review_settings.model_enabled is on and the function has its key
 * (ANTHROPIC_API_KEY, in the function's secrets — never in the repository or
 * in Vercel); without either, the rules read alone.
 */

import { AnthropicModelClient } from "../_shared/reviews/classify.ts";
import { runReviewClassify } from "../_shared/reviews/classify-run.ts";
import { createClassifyStore } from "../_shared/reviews/classify-db.ts";
import { defaultHostId } from "../_shared/reviews/db.ts";
import { serveJob } from "../_shared/reviews/http.ts";

serveJob("classify-reviews", async (client) => {
  const hostId = await defaultHostId(client);
  const key = Deno.env.get("ANTHROPIC_API_KEY")?.trim() ?? "";
  return await runReviewClassify({
    store: createClassifyStore(client, hostId),
    model: key === "" ? null : new AnthropicModelClient(key),
  });
});
