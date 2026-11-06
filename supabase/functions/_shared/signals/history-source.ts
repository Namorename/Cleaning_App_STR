/**
 * What a PMS gives of its past, for the reading of old reviews
 * (docs/property-intelligence-plan.md §4.1, §4.4). The contract of an adapter's
 * history, beside adapter.ts and not inside it: the functions already deployed
 * bundle adapter.ts, and this reading changes nothing they do.
 *
 * How far back is the PMS's to say (`history.maxDepthMonths`), never a constant
 * of the core: another company on another PMS with another depth runs the same
 * code. The core takes the less of that and the company's setting.
 *
 * Names live in memory only, as in adapter.ts: `stayGuestNames` exists for the
 * redaction, and no row built from a stay carries a guest.
 */

import type { FetchedReviews, Provider, TimeWindow } from "./adapter.ts";
import type { SignalChannel } from "./types.ts";

export interface HistoryCapability {
  /** How many months back this PMS can be read. */
  readonly maxDepthMonths: number;
}

/** One live stay as a number: where, through which channel, when it ended, how long. No guest. */
export interface NeutralStayFact {
  readonly external_listing_id: string;
  readonly channel: SignalChannel;
  /** `YYYY-MM-DD`. */
  readonly departure_date: string;
  readonly nights: number;
}

/** When a listing appeared in the PMS. Null when the PMS cannot say. */
export interface ListingBirth {
  readonly external_listing_id: string;
  /** `YYYY-MM-DD`. */
  readonly born_on: string | null;
}

export interface HistorySource {
  readonly provider: Provider;
  readonly history: HistoryCapability;
  /** Published guest reviews of the stays that ended in the window. */
  fetchReviewsByStay(window: TimeWindow): Promise<FetchedReviews>;
  /** Live stays that ended in the window, without their guests. */
  fetchStayFacts(window: TimeWindow): Promise<readonly NeutralStayFact[]>;
  /** The booking's id → its guest's names, for stays that ended in the window. In memory only. */
  stayGuestNames(window: TimeWindow): Promise<ReadonlyMap<string, readonly string[]>>;
  fetchListingBirths(): Promise<readonly ListingBirth[]>;
}
