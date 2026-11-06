/**
 * Hostaway's past, as the neutral records of history-source.ts
 * (docs/property-intelligence-plan.md §1.2, §4.4). Only GET requests, and only
 * the fields named here are read: a raw booking carries contacts and a raw
 * listing carries passwords, and neither is handed on or kept.
 *
 * Hostaway quietly ignores a parameter it does not know, so the answer is checked
 * against the question, as hostaway.ts does: a review or a stay that ended
 * outside the asked days stops the run with `filter_ignored`. Checked on
 * 2026-11-06: `departureDateStart` and `departureDateEnd` narrow the reviews,
 * `departureStartDate` and `departureEndDate` the bookings.
 */

import { HostawayClient, type HostawayClientOptions, type HostawayCredentials } from "../hostaway.ts";
import { type FetchedReviews, type NeutralReview, SignalSourceError, type TimeWindow } from "./adapter.ts";
import type {
  HistoryCapability,
  HistorySource,
  ListingBirth,
  NeutralStayFact,
} from "./history-source.ts";
import {
  channelOf,
  HOSTAWAY_PROVIDER,
  idText,
  names,
  normalizeHostawayReview,
  parseHostawayDate,
  REVIEWS_ENDPOINT,
  REVIEWS_PAGE_SIZE,
  toSignalSourceError,
  utcDay,
} from "./hostaway.ts";

export const RESERVATIONS_ENDPOINT = "reservations";
export const LISTINGS_ENDPOINT = "listings";
const RESERVATIONS_PAGE_SIZE = 500;
const LISTINGS_PAGE_SIZE = 200;

/** Twelve months: the owner's decision of 2026-11-06, within what Hostaway keeps. */
export const HOSTAWAY_HISTORY: HistoryCapability = Object.freeze({ maxDepthMonths: 12 });

/** A stay that happened: the generator's rule (20260926102000), an owner's block is no stay. */
const LIVE_STATUSES: ReadonlySet<string> = new Set(["new", "modified"]);
/** The office's own booking: the guest name begins with "#" (public.is_service_booking). */
const SERVICE_BOOKING = /^[\s ]*#/;

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The last day of a window, whose `until` is not included. */
function lastDay(until: Date): string {
  return utcDay(new Date(until.getTime() - 1));
}

function nightsOf(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export class HostawayHistorySource implements HistorySource {
  readonly provider = HOSTAWAY_PROVIDER;
  readonly history = HOSTAWAY_HISTORY;
  readonly #client: HostawayClient;

  constructor(credentials: HostawayCredentials, options: HostawayClientOptions = {}) {
    this.#client = new HostawayClient(credentials, options);
  }

  async #list(
    what: string,
    endpoint: string,
    pageSize: number,
    params: Readonly<Record<string, string>>,
  ): Promise<unknown[]> {
    try {
      return await this.#client.listAll(endpoint, pageSize, params);
    } catch (error: unknown) {
      throw toSignalSourceError(error, what);
    }
  }

  async fetchReviewsByStay({ since, until }: TimeWindow): Promise<FetchedReviews> {
    const first = utcDay(since);
    const last = lastDay(until);
    const items = await this.#list("Reading past reviews", REVIEWS_ENDPOINT, REVIEWS_PAGE_SIZE, {
      type: "guest-to-host",
      departureDateStart: first,
      departureDateEnd: last,
      sortBy: "departureDate",
      sortOrder: "asc",
    });

    const reviews: NeutralReview[] = [];
    let skipped = 0;
    for (const item of items) {
      if (!isRecord(item)) {
        skipped += 1;
        continue;
      }
      const departure = parseHostawayDate(item.departureDate);
      if (item.type !== "guest-to-host" || (departure !== null && (departure < first || departure > last))) {
        throw new SignalSourceError("filter_ignored", "Hostaway answered outside the asked days or type");
      }
      if (item.status !== "published") {
        continue;
      }
      try {
        reviews.push(normalizeHostawayReview(item));
      } catch (error: unknown) {
        if (!(error instanceof SignalSourceError)) {
          throw error;
        }
        skipped += 1;
      }
    }
    return { reviews, skipped };
  }

  /** The bookings of a window, cut at once to the fields below. */
  async #bookings({ since, until }: TimeWindow): Promise<readonly Raw[]> {
    const first = utcDay(since);
    const last = lastDay(until);
    const items = await this.#list("Reading past stays", RESERVATIONS_ENDPOINT, RESERVATIONS_PAGE_SIZE, {
      departureStartDate: first,
      departureEndDate: last,
    });
    return items.filter(isRecord).map((item) => {
      const departure = parseHostawayDate(item.departureDate);
      if (departure !== null && (departure < first || departure > last)) {
        throw new SignalSourceError("filter_ignored", "Hostaway answered outside the asked days");
      }
      return {
        id: item.id,
        listingMapId: item.listingMapId,
        channelId: item.channelId,
        departureDate: departure,
        nights: item.nights,
        status: item.status,
        guestName: item.guestName,
        guestFirstName: item.guestFirstName,
        guestLastName: item.guestLastName,
      };
    });
  }

  async fetchStayFacts(window: TimeWindow): Promise<readonly NeutralStayFact[]> {
    const facts: NeutralStayFact[] = [];
    for (const booking of await this.#bookings(window)) {
      const listing = idText(booking.listingMapId);
      const departure = booking.departureDate;
      const isService = typeof booking.guestName === "string" && SERVICE_BOOKING.test(booking.guestName);
      if (
        listing === null || typeof departure !== "string" || isService ||
        typeof booking.status !== "string" || !LIVE_STATUSES.has(booking.status)
      ) {
        continue;
      }
      facts.push({
        external_listing_id: listing,
        channel: channelOf(booking.channelId),
        departure_date: departure,
        nights: nightsOf(booking.nights),
      });
    }
    return facts;
  }

  async stayGuestNames(window: TimeWindow): Promise<ReadonlyMap<string, readonly string[]>> {
    const byBooking = new Map<string, readonly string[]>();
    for (const booking of await this.#bookings(window)) {
      const id = idText(booking.id);
      if (id !== null) {
        byBooking.set(id, names(booking.guestName, booking.guestFirstName, booking.guestLastName));
      }
    }
    return byBooking;
  }

  async fetchListingBirths(): Promise<readonly ListingBirth[]> {
    const items = await this.#list("Reading listings", LISTINGS_ENDPOINT, LISTINGS_PAGE_SIZE, {});
    return items.filter(isRecord).flatMap((item) => {
      const id = idText(item.id);
      return id === null ? [] : [{ external_listing_id: id, born_on: parseHostawayDate(item.insertedOn) }];
    });
  }
}
