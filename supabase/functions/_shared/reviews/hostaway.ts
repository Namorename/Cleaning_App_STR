/**
 * The Hostaway adapter for guest reviews (docs/reviews-to-tasks.md §2.4).
 *
 * It reads through the shared client (`_shared/hostaway.ts`, not changed for
 * this): `listAll` for the list, `getObject` for the one booking whose room
 * a review of a building needs. What it hands on is the neutral row of
 * types.ts; the guest's names travel beside it only to be stripped from the
 * texts, and are never part of a row.
 *
 * Hostaway quietly ignores a parameter it does not know, so the adapter
 * checks the answer against the question: a review of another type, or one
 * sent before `since`, means the filter did not hold, and the run stops with
 * a code rather than loading the wrong window.
 */

import type { HostawayClient } from "../hostaway.ts";
import {
  CATEGORY_KEYS,
  type FetchedReviews,
  isOneOf,
  type NeutralReviewRow,
  type ReviewChannel,
  type ReviewSourceAdapter,
  ReviewSourceError,
  type SourceReview,
} from "./types.ts";

export const REVIEWS_ENDPOINT = "reviews";

/** One page holds a normal day many times over (≈ 12 reviews a day, docs §1.2). */
export const REVIEWS_PAGE_SIZE = 500;

/** Hostaway's channel ids, as the account uses them (docs §1.1). */
const CHANNEL_BY_ID: Readonly<Record<number, ReviewChannel>> = {
  2018: "airbnb",
  2005: "booking",
  2002: "vrbo",
  2000: "direct",
  // The booking engine is the company's own site: a direct booking.
  2013: "direct",
  2022: "google",
};

/** Our id of a room: 10¹² + Hostaway's listingUnitId (property_id_for_unit). */
export const ROOM_ID_BASE = 1_000_000_000_000;

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveInteger(value: unknown): number | null {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function rating(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10
    ? value
    : null;
}

/** "2026-10-15 12:34:56" (UTC, as Hostaway writes it) → "2026-10-15T12:34:56Z"; anything else → null. */
export function parseHostawayTime(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value.trim());
  if (match === null) {
    return null;
  }
  const iso = `${match[1]}T${match[2]}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** "2026-10-15 00:00:00" or "2026-10-15" → "2026-10-15"; anything else → null. */
export function parseHostawayDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match !== null && !Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`)) ? match[1] : null;
}

/** The day of a moment in UTC, as `submittedAtStart` takes it. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function categories(raw: Raw): { ratings: Record<string, number>; comments: Record<string, string> } {
  const ratings: Record<string, number> = {};
  const comments: Record<string, string> = {};
  const list = Array.isArray(raw.reviewCategory) ? raw.reviewCategory : [];
  for (const entry of list) {
    if (!isRecord(entry) || !isOneOf(CATEGORY_KEYS, entry.category)) {
      continue;
    }
    const value = rating(entry.rating);
    if (value !== null) {
      ratings[entry.category] = value;
    }
    const comment = text(entry.comment);
    if (comment !== null) {
      comments[entry.category] = comment;
    }
  }
  return { ratings, comments };
}

function names(...values: unknown[]): string[] {
  return values.map(text).filter((value): value is string => value !== null);
}

/**
 * One Hostaway review → the neutral row, its texts and the names to strip.
 * Throws ReviewSourceError for a row the database could not key (no id, no
 * listing, no time it was sent): it is counted and skipped, never guessed.
 */
export function normalizeHostawayReview(raw: unknown): SourceReview {
  if (!isRecord(raw)) {
    throw new ReviewSourceError("source_bad_row", "A review is not an object");
  }
  const id = positiveInteger(raw.id);
  const listing = positiveInteger(raw.listingMapId);
  const submittedAt = parseHostawayTime(raw.submittedAt);
  if (id === null || listing === null || submittedAt === null) {
    throw new ReviewSourceError("source_bad_row", "A review has no id, listing or submission time");
  }

  const reservation = positiveInteger(raw.reservationId);
  const channelId = positiveInteger(raw.channelId);
  const { ratings, comments } = categories(raw);
  const publicText = text(raw.publicReview);
  const privateText = text(raw.privateFeedback);

  const row: NeutralReviewRow = {
    external_id: String(id),
    external_listing_id: String(listing),
    listing_id: listing,
    room_id: null,
    external_reservation_id: reservation === null ? null : String(reservation),
    // Hostaway's booking id is ours: the reservations table is keyed by it.
    reservation_id: reservation,
    channel: (channelId !== null ? CHANNEL_BY_ID[channelId] : undefined) ?? "other",
    rating: rating(raw.rating),
    category_ratings: ratings,
    arrival_date: parseHostawayDate(raw.arrivalDate),
    departure_date: parseHostawayDate(raw.departureDate),
    submitted_at: submittedAt,
    is_hidden: raw.isHidden === 1 || raw.isHidden === true,
    has_public_text: publicText !== null,
    has_private_text: privateText !== null,
    has_host_reply: text(raw.revieweeResponse) !== null,
    external_updated_at: parseHostawayTime(raw.updatedOn),
  };

  return {
    row,
    texts: { publicText, privateText, categoryComments: comments },
    guestNames: names(raw.guestName, raw.reviewerName),
    listingNames: names(raw.listingName, raw.internalListingName, raw.externalListingName),
  };
}

export class HostawayReviewAdapter implements ReviewSourceAdapter {
  readonly source = "hostaway" as const;
  readonly #client: HostawayClient;
  readonly #pageSize: number;

  constructor(client: HostawayClient, options: { pageSize?: number } = {}) {
    this.#client = client;
    this.#pageSize = options.pageSize ?? REVIEWS_PAGE_SIZE;
  }

  /**
   * Published guest reviews sent from the day of `since` up to `until`.
   * The list is asked oldest first; a review not yet published (Hostaway
   * keeps a row for every stay long before the guest writes) is dropped.
   */
  async fetchPublished(since: Date, until: Date): Promise<FetchedReviews> {
    const startDay = utcDay(since);
    const items = await this.#client.listAll(REVIEWS_ENDPOINT, this.#pageSize, {
      type: "guest-to-host",
      submittedAtStart: startDay,
      sortBy: "submittedAt",
      sortOrder: "asc",
    });

    const floor = `${startDay}T00:00:00Z`;
    const ceiling = until.toISOString();
    const reviews: SourceReview[] = [];
    let skipped = 0;

    for (const item of items) {
      if (!isRecord(item)) {
        skipped += 1;
        continue;
      }
      const sentAt = parseHostawayTime(item.submittedAt);
      if (item.type !== "guest-to-host" || (sentAt !== null && sentAt < floor)) {
        throw new ReviewSourceError(
          "source_filter_ignored",
          "Hostaway answered outside the asked window or type",
        );
      }
      if (item.status !== "published" || sentAt === null || sentAt >= ceiling) {
        continue;
      }
      try {
        reviews.push(normalizeHostawayReview(item));
      } catch (error: unknown) {
        if (!(error instanceof ReviewSourceError)) {
          throw error;
        }
        skipped += 1;
      }
    }

    return { reviews, skipped };
  }

  /**
   * The room of a stay on a building: Hostaway names it on the booking
   * (`reservationUnit[].listingUnitId`), also for a past booking we no longer
   * hold. A booking of several rooms names no one room: null, the building.
   */
  async roomOf(review: SourceReview): Promise<number | null> {
    if (review.row.reservation_id === null) {
      return null;
    }
    const booking = await this.#client.getObject(
      `reservations/${review.row.reservation_id}?includeResources=1`,
    );
    const units = Array.isArray(booking.reservationUnit) ? booking.reservationUnit : [];
    const ids = units
      .map((unit) => (isRecord(unit) ? positiveInteger(unit.listingUnitId) : null))
      .filter((unit): unit is number => unit !== null);
    const distinct = [...new Set(ids)];
    return distinct.length === 1 ? ROOM_ID_BASE + distinct[0] : null;
  }
}
