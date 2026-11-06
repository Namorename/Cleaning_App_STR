import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

import { SignalSourceError } from "./adapter.ts";
import { checkHistoryContract } from "./history-contract.ts";
import { HostawayHistorySource } from "./hostaway-history.ts";

// Hostaway on a fake network, in the live API's field names. Nothing here is a
// real guest, text or id.

type Raw = Record<string, unknown>;

interface World {
  readonly reviews?: readonly Raw[];
  readonly reservations?: readonly Raw[];
  readonly listings?: readonly Raw[];
}

const WINDOW = { since: new Date("2026-03-02T00:00:00Z"), until: new Date("2026-03-09T00:00:00Z") };

function review(id: number, over: Raw = {}): Raw {
  return {
    id,
    type: "guest-to-host",
    status: "published",
    listingMapId: 100,
    channelId: 2018,
    reservationId: 500 + id,
    rating: 8,
    publicReview: "The wifi kept dropping.",
    privateFeedback: "Between us: the sofa.",
    guestName: "Zuzana Synthetic",
    listingName: "Synthetic Loft",
    arrivalDate: "2026-03-01",
    departureDate: "2026-03-04",
    submittedAt: "2026-03-05 10:00:00",
    ...over,
  };
}

function booking(id: number, over: Raw = {}): Raw {
  return {
    id,
    listingMapId: 100,
    channelId: 2005,
    status: "new",
    nights: 3,
    arrivalDate: "2026-03-01",
    departureDate: "2026-03-04",
    guestName: "Zuzana Synthetic",
    guestFirstName: "Zuzana",
    guestLastName: "Synthetic",
    phone: "+420 000 000 000",
    guestEmail: "zuzana@example.test",
    totalPrice: 5000,
    doorCode: "1234",
    ...over,
  };
}

function hostaway(world: World) {
  const requests: string[] = [];
  const methods: string[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/v1\//, "");
    const json = (body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    if (path === "accessTokens") {
      return json({ access_token: "test-token" });
    }
    requests.push(`${path}${url.search}`);
    methods.push(init?.method ?? "GET");
    const rows = world[path as keyof World] ?? [];
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    return json({
      status: "success",
      result: rows.slice(offset, offset + limit),
      limit,
      offset,
      count: rows.length,
    });
  };
  const source = new HostawayHistorySource(
    { accountId: "1", apiKey: "k" },
    { fetchImpl: fetchImpl as typeof fetch, sleep: () => Promise.resolve() },
  );
  return { source, requests, methods };
}

Deno.test("Hostaway keeps the history contract", async () => {
  const { source } = hostaway({
    reviews: [review(1), review(2, { status: "expired" })],
    reservations: [booking(501), booking(502, { status: "cancelled" })],
    listings: [{ id: 100, insertedOn: "2022-01-20 10:00:00", wifiPassword: "secret" }],
  });
  await checkHistoryContract({
    source,
    window: WINDOW,
    reviewIds: ["1"],
    stays: 1,
    booking: { id: "501", name: "Zuzana" },
    guestWords: ["Zuzana", "Synthetic", "+420", "example.test", "1234"],
  });
});

Deno.test("Hostaway is read twelve months back", () => {
  assertEquals(hostaway({}).source.history.maxDepthMonths, 12);
});

Deno.test("reviews are asked by the days the guests left, and only by GET", async () => {
  const { source, requests, methods } = hostaway({ reviews: [review(1)] });
  await source.fetchReviewsByStay(WINDOW);
  const query = new URLSearchParams(requests[0].split("?")[1]);
  assertEquals(query.get("departureDateStart"), "2026-03-02");
  assertEquals(query.get("departureDateEnd"), "2026-03-08");
  assertEquals(query.get("type"), "guest-to-host");
  assertEquals([...new Set(methods)], ["GET"]);
});

Deno.test("a review outside the asked days stops the run", async () => {
  const { source } = hostaway({ reviews: [review(1, { departureDate: "2026-02-01" })] });
  const error = await assertRejects(() => source.fetchReviewsByStay(WINDOW), SignalSourceError);
  assertEquals((error as SignalSourceError).code, "filter_ignored");
});

Deno.test("a review of another type stops the run", async () => {
  const { source } = hostaway({ reviews: [review(1, { type: "host-to-guest" })] });
  await assertRejects(() => source.fetchReviewsByStay(WINDOW), SignalSourceError);
});

Deno.test("a review not yet published has no date to check and is dropped", async () => {
  const { source } = hostaway({
    reviews: [review(1, { status: "awaiting", departureDate: null, submittedAt: null })],
  });
  assertEquals((await source.fetchReviewsByStay(WINDOW)).reviews, []);
});

Deno.test("a row that cannot be read is counted, not kept", async () => {
  const { source } = hostaway({ reviews: [review(1, { listingMapId: null }), "not a row" as unknown as Raw] });
  const { reviews, skipped } = await source.fetchReviewsByStay(WINDOW);
  assertEquals(reviews, []);
  assertEquals(skipped, 2);
});

Deno.test("a stay outside the asked days stops the run", async () => {
  const { source } = hostaway({ reservations: [booking(1, { departureDate: "2026-04-01" })] });
  const error = await assertRejects(() => source.fetchStayFacts(WINDOW), SignalSourceError);
  assertEquals((error as SignalSourceError).code, "filter_ignored");
});

Deno.test("an owner's block, a cancelled booking and the office's own are no stays", async () => {
  const { source } = hostaway({
    reservations: [
      booking(1),
      booking(2, { status: "modified" }),
      booking(3, { status: "ownerStay" }),
      booking(4, { status: "cancelled" }),
      booking(5, { guestName: "  # cleaning block" }),
    ],
  });
  assertEquals((await source.fetchStayFacts(WINDOW)).length, 2);
});

Deno.test("a stay is a channel, a day and nights", async () => {
  const { source } = hostaway({ reservations: [booking(1)] });
  assertEquals(await source.fetchStayFacts(WINDOW), [
    { external_listing_id: "100", channel: "booking", departure_date: "2026-03-04", nights: 3 },
  ]);
});

Deno.test("a stay with no nights counts as a stay of none, never a negative", async () => {
  const { source } = hostaway({ reservations: [booking(1, { nights: -2 })] });
  assertEquals((await source.fetchStayFacts(WINDOW))[0].nights, 0);
});

Deno.test("names of a booking are all its names, for the redaction", async () => {
  const { source } = hostaway({ reservations: [booking(7)] });
  const names = await source.stayGuestNames(WINDOW);
  assertEquals(names.get("7"), ["Zuzana Synthetic", "Zuzana", "Synthetic"]);
});

Deno.test("a listing is born on the day it was inserted, or the PMS cannot say", async () => {
  const { source } = hostaway({
    listings: [{ id: 1, insertedOn: "2024-05-06 08:00:00" }, { id: 2 }, { id: "bad" }],
  });
  assertEquals(await source.fetchListingBirths(), [
    { external_listing_id: "1", born_on: "2024-05-06" },
    { external_listing_id: "2", born_on: null },
  ]);
});

Deno.test("a refusal of Hostaway reaches the run as a code, without its words", async () => {
  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    return Promise.resolve(
      url.includes("accessTokens")
        ? new Response(JSON.stringify({ access_token: "t" }), { status: 200 })
        : new Response("the guest Zuzana is at fault", { status: 500 }),
    );
  };
  const source = new HostawayHistorySource(
    { accountId: "1", apiKey: "k" },
    { fetchImpl: fetchImpl as typeof fetch, sleep: () => Promise.resolve() },
  );
  const error = await assertRejects(() => source.fetchListingBirths(), SignalSourceError);
  assert(!(error as SignalSourceError).message.includes("Zuzana"));
});
