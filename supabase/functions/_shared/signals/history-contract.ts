/**
 * What every PMS's history must do (history-source.ts), as a check any adapter
 * and the tests' fake run against a known world. No function imports this file.
 */

import { assert, assertEquals } from "jsr:@std/assert@1";

import type { TimeWindow } from "./adapter.ts";
import type { HistorySource } from "./history-source.ts";
import { SIGNAL_CHANNELS } from "./types.ts";

/** The only fields a stay may carry: no guest, no money, no booking. */
const STAY_FIELDS = ["channel", "departure_date", "external_listing_id", "nights"];

export interface HistoryScenario {
  readonly source: HistorySource;
  readonly window: TimeWindow;
  /** Published reviews of stays that ended in the window. */
  readonly reviewIds: readonly string[];
  /** Live stays that ended in the window. */
  readonly stays: number;
  /** A booking of the window, and a name it carries. */
  readonly booking: { readonly id: string; readonly name: string };
  /** Words of the world's guests and contacts: never on a stay. */
  readonly guestWords: readonly string[];
}

export async function checkHistoryContract(scenario: HistoryScenario): Promise<void> {
  const { source, window } = scenario;

  const depth = source.history.maxDepthMonths;
  assert(Number.isInteger(depth) && depth > 0, "a PMS says how far back it can be read");

  const { reviews } = await source.fetchReviewsByStay(window);
  assertEquals(reviews.map((review) => review.row.external_id).sort(), [...scenario.reviewIds].sort());

  const stays = await source.fetchStayFacts(window);
  assertEquals(stays.length, scenario.stays);
  for (const stay of stays) {
    assertEquals(Object.keys(stay).sort(), STAY_FIELDS);
    assert((SIGNAL_CHANNELS as readonly string[]).includes(stay.channel));
    assert(/^\d{4}-\d{2}-\d{2}$/.test(stay.departure_date));
    assert(Number.isInteger(stay.nights) && stay.nights >= 0);
  }
  const words = JSON.stringify(stays);
  for (const word of scenario.guestWords) {
    assert(!words.includes(word), "a stay carries no guest");
  }

  const names = await source.stayGuestNames(window);
  assert(names.get(scenario.booking.id)?.includes(scenario.booking.name));

  const births = await source.fetchListingBirths();
  assert(births.length > 0, "a PMS lists its listings");
  for (const birth of births) {
    assert(birth.born_on === null || /^\d{4}-\d{2}-\d{2}$/.test(birth.born_on));
  }
}
