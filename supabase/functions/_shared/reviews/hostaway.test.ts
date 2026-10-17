import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

import { HostawayClient } from "../hostaway.ts";
import {
  HostawayReviewAdapter,
  normalizeHostawayReview,
  parseHostawayDate,
  parseHostawayTime,
  ROOM_ID_BASE,
} from "./hostaway.ts";
import { ReviewSourceError } from "./types.ts";

// Synthetic rows in Hostaway's shape (field names as the API sends them,
// docs/reviews-to-tasks.md §1.1). No real guest, text or id.
function hostawayReview(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 90000001,
    listingMapId: 700001,
    reservationId: 80000001,
    channelId: 2018,
    type: "guest-to-host",
    status: "published",
    rating: 8,
    reviewCategory: [
      { category: "cleanliness", rating: 10, comment: null },
      { category: "checkin", rating: 6, comment: "The key box code was wrong." },
      { category: "respect_house_rules", rating: 10, comment: null },
    ],
    publicReview: "Nice flat, but the shower had no hot water.",
    privateFeedback: null,
    revieweeResponse: null,
    isHidden: 0,
    submittedAt: "2026-10-15 09:30:00",
    updatedOn: "2026-10-15 09:31:00",
    arrivalDate: "2026-10-10 00:00:00",
    departureDate: "2026-10-13 00:00:00",
    guestName: "Synthetic Guest",
    reviewerName: "Synthetic",
    listingName: "Test Flat A",
    internalListingName: "TF-A",
    externalListingName: "Cosy test flat",
    ...overrides,
  };
}

Deno.test("a Hostaway review becomes the neutral row: no name in it, texts beside it", () => {
  const review = normalizeHostawayReview(hostawayReview());

  assertEquals(review.row.external_id, "90000001");
  assertEquals(review.row.listing_id, 700001);
  assertEquals(review.row.reservation_id, 80000001);
  assertEquals(review.row.external_reservation_id, "80000001");
  assertEquals(review.row.channel, "airbnb");
  assertEquals(review.row.category_ratings, { cleanliness: 10, checkin: 6 });
  assertEquals(review.row.arrival_date, "2026-10-10");
  assertEquals(review.row.submitted_at, "2026-10-15T09:30:00Z");
  assertEquals(review.row.has_public_text, true);
  assertEquals(review.row.has_private_text, false);
  assertEquals(review.row.is_hidden, false);
  assertEquals(review.texts.categoryComments, { checkin: "The key box code was wrong." });
  assertEquals(review.guestNames, ["Synthetic Guest", "Synthetic"]);
  assert(!JSON.stringify(review.row).includes("Synthetic"), "a guest name reached the row");
  assert(!("public_text" in review.row), "a text reached the row before redaction");
});

Deno.test("an unknown channel is other, a hidden flag of 1 is hidden, a reply is seen", () => {
  const review = normalizeHostawayReview(
    hostawayReview({ channelId: 9999, isHidden: 1, revieweeResponse: "Thank you!" }),
  );
  assertEquals(review.row.channel, "other");
  assertEquals(review.row.is_hidden, true);
  assertEquals(review.row.has_host_reply, true);
});

Deno.test("a row without an id, a listing or a time it was sent is refused, not guessed", () => {
  for (const broken of [{ id: null }, { listingMapId: "x" }, { submittedAt: "yesterday" }]) {
    let code: string | null = null;
    try {
      normalizeHostawayReview(hostawayReview(broken));
    } catch (error: unknown) {
      code = error instanceof ReviewSourceError ? error.code : "other";
    }
    assertEquals(code, "source_bad_row");
  }
});

Deno.test("Hostaway's times and dates are read as UTC days and moments", () => {
  assertEquals(parseHostawayTime("2026-01-31 23:59:59"), "2026-01-31T23:59:59Z");
  assertEquals(parseHostawayTime("31.01.2026"), null);
  assertEquals(parseHostawayDate("2026-02-01 00:00:00"), "2026-02-01");
  assertEquals(parseHostawayDate(null), null);
});

/** A HostawayClient over a fake network: one token, then the planned answers. */
function clientWith(answers: unknown[]): { client: HostawayClient; urls: string[] } {
  const urls: string[] = [];
  const queue = [...answers];
  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    urls.push(url);
    const body = url.endsWith("accessTokens") ? { access_token: "test-token" } : queue.shift();
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  const client = new HostawayClient(
    { accountId: "1", apiKey: "test" },
    { fetchImpl, sleep: () => Promise.resolve(), now: () => 0 },
  );
  return { client, urls };
}

Deno.test("the adapter asks for guest reviews from the day, keeps the published ones in the window", async () => {
  const since = new Date("2026-10-12T06:00:00Z");
  const until = new Date("2026-10-15T12:00:00Z");
  const { client, urls } = clientWith([
    {
      status: "success",
      result: [
        hostawayReview({ id: 1, submittedAt: "2026-10-12 08:00:00" }),
        hostawayReview({ id: 2, status: "awaiting", submittedAt: "2026-10-13 08:00:00" }),
        hostawayReview({ id: 3, submittedAt: "2026-10-15 13:00:00" }),
        hostawayReview({ id: 4, listingMapId: null, submittedAt: "2026-10-14 08:00:00" }),
      ],
    },
  ]);

  const fetched = await new HostawayReviewAdapter(client).fetchPublished(since, until);

  assertEquals(fetched.reviews.map((r) => r.row.external_id), ["1"]);
  assertEquals(fetched.skipped, 1);
  const list = new URL(urls.find((u) => u.includes("/reviews?")) as string);
  assertEquals(list.searchParams.get("type"), "guest-to-host");
  assertEquals(list.searchParams.get("submittedAtStart"), "2026-10-12");
  assertEquals(list.searchParams.get("sortBy"), "submittedAt");
});

Deno.test("an answer outside the asked window means the filter did not hold: the run stops", async () => {
  const { client } = clientWith([
    { status: "success", result: [hostawayReview({ submittedAt: "2026-09-01 08:00:00" })] },
  ]);
  const adapter = new HostawayReviewAdapter(client);
  const error = await assertRejects(
    () => adapter.fetchPublished(new Date("2026-10-12T00:00:00Z"), new Date("2026-10-15T00:00:00Z")),
    ReviewSourceError,
  );
  assertEquals(error.code, "source_filter_ignored");
});

Deno.test("the booking gives the room of a building's stay and the guest's names; several rooms name none", async () => {
  const review = normalizeHostawayReview(hostawayReview());
  const one = clientWith([
    {
      status: "success",
      result: {
        id: 80000001,
        reservationUnit: [{ listingUnitId: 61011 }],
        guestName: "Synthetic Booker",
        guestFirstName: "Synthetic",
        guestLastName: "Booker",
      },
    },
  ]);
  assertEquals(await new HostawayReviewAdapter(one.client).bookingOf(review), {
    roomId: ROOM_ID_BASE + 61011,
    guestNames: ["Synthetic Booker", "Synthetic", "Booker"],
  });
  assert(one.urls.some((u) => u.endsWith("reservations/80000001?includeResources=1")));

  const two = clientWith([
    {
      status: "success",
      result: { reservationUnit: [{ listingUnitId: 61011 }, { listingUnitId: 61012 }] },
    },
  ]);
  assertEquals(await new HostawayReviewAdapter(two.client).bookingOf(review), {
    roomId: null,
    guestNames: [],
  });
});

Deno.test("a review without a booking asks nothing", async () => {
  const review = normalizeHostawayReview(hostawayReview({ reservationId: null }));
  const none = clientWith([]);
  assertEquals(await new HostawayReviewAdapter(none.client).bookingOf(review), {
    roomId: null,
    guestNames: [],
  });
  assertEquals(none.urls, []);
});
