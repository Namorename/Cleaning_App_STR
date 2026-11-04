/**
 * The one question guest-review-text asks Hostaway: the guest reviews sent
 * within a window of days, both ends whole days — a GET, paged as the load
 * pages it. Hostaway ignores a filter it does not know, so the window is
 * checked in handler.ts by the key, not trusted from the answer.
 */

import type { HostawayClient } from "../_shared/hostaway.ts";
import { REVIEWS_ENDPOINT, REVIEWS_PAGE_SIZE } from "../_shared/signals/hostaway.ts";
import type { SearchWindow } from "./handler.ts";

export function listHostawayReviews(
  client: Pick<HostawayClient, "listAll">,
  window: SearchWindow,
): Promise<unknown[]> {
  return client.listAll(REVIEWS_ENDPOINT, REVIEWS_PAGE_SIZE, {
    type: "guest-to-host",
    submittedAtStart: window.start,
    submittedAtEnd: window.end,
    sortBy: "submittedAt",
    sortOrder: "asc",
  });
}
