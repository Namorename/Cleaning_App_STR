import { assert, assertEquals } from "jsr:@std/assert@1";

import { HostawayClient, HostawayError } from "../_shared/hostaway.ts";
import {
  fakeHostawayApi,
  HOSTAWAY_GUEST_WORDS,
  hostawayReview,
} from "../_shared/signals/hostaway-fake-api.ts";
import { createSignalKeyer } from "../_shared/signals/key.ts";
import {
  type Caller,
  createReviewTextHandler,
  findTexts,
  type ReviewTextDeps,
  searchWindow,
  type StoredReview,
} from "./handler.ts";
import { listHostawayReviews } from "./pms.ts";

// Synthetic only: the reviews are the fake PMS's, the key secret is the tests'.
const SECRET = "test-only-signal-key-secret-0123456789abcdef";
const keyOf = await createSignalKeyer("hostaway", "review", SECRET);

const SIGNAL_ID = "22222222-2222-4222-8222-222222222222";
const HOST_ID = "11111111-1111-4111-8111-111111111111";
const MANAGER: Caller = { id: "33333333-3333-4333-8333-333333333333", role: "manager", hostId: HOST_ID, isActive: true };

const WANTED = hostawayReview({
  id: 90000002,
  publicReview: "SYNTH-REVIEW-TEXT: the shower had no hot water.",
  privateFeedback: "SYNTH-GUEST-TEXT: the door code worked once.",
});
const OTHER = hostawayReview({ id: 90000001, publicReview: "SYNTH-NESTED-TEXT: another stay." });

const STORED: StoredReview = {
  provider: "hostaway",
  externalKey: await keyOf("90000002"),
  submittedAt: "2026-09-30T22:00:00Z",
  stayExact: false,
};

interface World {
  readonly deps: ReviewTextDeps;
  readonly logs: string[];
  readonly calls: string[];
}

function world(overrides: Partial<ReviewTextDeps> = {}): World {
  const logs: string[] = [];
  const calls: string[] = [];
  const deps: ReviewTextDeps = {
    identify: (token) => Promise.resolve(token === "session" ? MANAGER : null),
    takeRead: (userId) => {
      calls.push(`take ${userId}`);
      return Promise.resolve(true);
    },
    findReview: (hostId, signalId) => {
      calls.push(`find ${hostId} ${signalId}`);
      return Promise.resolve(hostId === HOST_ID && signalId === SIGNAL_ID ? STORED : null);
    },
    listReviews: (window) => {
      calls.push(`list ${window.start}..${window.end}`);
      return Promise.resolve([OTHER, WANTED]);
    },
    keyOf,
    now: () => Date.parse("2026-11-04T10:03:20Z"),
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, logs, calls };
}

function post(body: unknown = { signal_id: SIGNAL_ID }, token: string | null = "session"): Request {
  return new Request("http://x/guest-review-text", {
    method: "POST",
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      "Content-Type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function hintOf(response: Response): Promise<string> {
  const body = await response.json();
  return body.error.hint;
}

function assertNoGuestWords(text: string): void {
  for (const word of HOSTAWAY_GUEST_WORDS) {
    assert(!text.includes(word), `«${word}» leaked`);
  }
}

Deno.test("an office reader gets the review's own words, and nothing that names the guest or the booking", async () => {
  const { deps, logs } = world();

  const response = await createReviewTextHandler(deps)(post());

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  const text = await response.text();
  assertEquals(JSON.parse(text), {
    data: {
      public_text: "SYNTH-REVIEW-TEXT: the shower had no hot water.",
      private_text: "SYNTH-GUEST-TEXT: the door code worked once.",
      category_comments: { checkin: "SYNTH-COMMENT-TEXT: the key box code was wrong." },
    },
  });
  for (const word of ["Synthia", "Reviewer", "Test Flat A", "TF-A", "Cosy test flat", "80000001", "90000002", "700001"]) {
    assert(!text.includes(word), `«${word}» went back to the panel`);
  }
  assertEquals(logs, ["guest-review-text ok in 0 ms"]);
});

Deno.test("the log keeps one code a request, never a text, a name or an id", async () => {
  const { deps, logs } = world();
  const handler = createReviewTextHandler(deps);
  await handler(post());
  await handler(post({ signal_id: "44444444-4444-4444-8444-444444444444" }));

  const all = logs.join("\n");
  assertNoGuestWords(all);
  assert(!all.includes(SIGNAL_ID));
  assertEquals(logs.map((line) => line.split(" ")[1]), ["ok", "not_found"]);
});

Deno.test("the review is looked for in its month, with a day on either side, once the stay is cut", () => {
  assertEquals(searchWindow({ submittedAt: "2026-09-30T22:00:00Z", stayExact: false }), {
    start: "2026-09-30",
    end: "2026-11-01",
  });
  // Winter time: December begins at 23:00 UTC; the window crosses the year.
  assertEquals(searchWindow({ submittedAt: "2026-11-30T23:00:00Z", stayExact: false }), {
    start: "2026-11-30",
    end: "2027-01-01",
  });
  assertEquals(searchWindow({ submittedAt: "2026-10-15T09:30:00Z", stayExact: true }), {
    start: "2026-10-14",
    end: "2026-10-16",
  });
});

Deno.test("the month's reviews are asked of Hostaway with both ends, by a GET", async () => {
  const api = fakeHostawayApi({ reviews: [OTHER, WANTED] });
  const client = new HostawayClient(
    { accountId: "1", apiKey: "test-only-key" },
    { fetchImpl: api.fetchImpl, sleep: () => Promise.resolve(), now: () => 0 },
  );

  const items = await listHostawayReviews(client, { start: "2026-09-30", end: "2026-11-01" });

  assertEquals(items.length, 2);
  assertEquals(api.requests.length, 1);
  const query = new URL(`http://x/${api.requests[0]}`).searchParams;
  assertEquals(new URL(`http://x/${api.requests[0]}`).pathname, "/reviews");
  assertEquals(query.get("type"), "guest-to-host");
  assertEquals(query.get("submittedAtStart"), "2026-09-30");
  assertEquals(query.get("submittedAtEnd"), "2026-11-01");
  assertEquals(query.get("limit"), "500");
});

Deno.test("the review is matched by its key alone; one the PMS no longer has is not found", async () => {
  assertEquals((await findTexts([OTHER, "junk", null, WANTED], STORED.externalKey, keyOf))?.public_text, WANTED.publicReview);
  assertEquals(await findTexts([OTHER], STORED.externalKey, keyOf), null);

  const { deps } = world({ listReviews: () => Promise.resolve([OTHER]) });
  const response = await createReviewTextHandler(deps)(post());
  assertEquals(response.status, 404);
  assertEquals(await hintOf(response), "serverErrors.reviewTextNotFound");
});

Deno.test("no token, a token of nobody, or a person outside the office reads nothing", async () => {
  const cases: [Request, Partial<ReviewTextDeps>, number, string][] = [
    [post(undefined, null), {}, 401, "serverErrors.notSignedIn"],
    [post(undefined, "stolen"), {}, 401, "serverErrors.notSignedIn"],
    [post(), { identify: () => Promise.resolve({ ...MANAGER, role: "cleaner" }) }, 403, "serverErrors.managerOnly"],
    [post(), { identify: () => Promise.resolve({ ...MANAGER, role: "head_tech" }) }, 403, "serverErrors.managerOnly"],
    [post(), { identify: () => Promise.resolve({ ...MANAGER, isActive: false }) }, 403, "serverErrors.managerOnly"],
  ];
  for (const [request, overrides, status, hint] of cases) {
    const { deps, calls } = world(overrides);
    const response = await createReviewTextHandler(deps)(request);
    assertEquals(response.status, status);
    assertEquals(await hintOf(response), hint);
    assertEquals(calls, [], "nothing is counted or looked up before the caller is known");
  }
});

Deno.test("an admin reads too", async () => {
  const { deps } = world({ identify: () => Promise.resolve({ ...MANAGER, role: "admin" }) });
  assertEquals((await createReviewTextHandler(deps)(post())).status, 200);
});

Deno.test("only our id of a review of the company is taken: not another company's, not a PMS id", async () => {
  const cases: unknown[] = [{ signal_id: "90000002" }, { id: SIGNAL_ID }, "not json", [SIGNAL_ID], { signal_id: "x".repeat(2000) }];
  for (const body of cases) {
    const { deps, calls } = world();
    const response = await createReviewTextHandler(deps)(post(body));
    assertEquals(response.status, 400);
    assertEquals(calls, []);
  }

  const elsewhere = world({ identify: () => Promise.resolve({ ...MANAGER, hostId: "55555555-5555-4555-8555-555555555555" }) });
  const response = await createReviewTextHandler(elsewhere.deps)(post());
  assertEquals(response.status, 404);
  assert(!elsewhere.calls.some((call) => call.startsWith("list")), "the PMS is not asked for another company's review");
});

Deno.test("a body sent in chunks without its length is not read past the cap", async () => {
  const { deps, calls } = world();
  const chunk = new TextEncoder().encode(`{"signal_id":"${SIGNAL_ID}","pad":"${"x".repeat(600)}`);
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      // A body that would never end: only the cap stops the reading.
      controller.enqueue(chunk);
    },
  });
  const request = new Request("http://x/guest-review-text", {
    method: "POST",
    headers: { Authorization: "Bearer session", "Content-Type": "application/json" },
    body,
  });

  const response = await createReviewTextHandler(deps)(request);

  assertEquals(response.status, 400);
  assert(pulled <= 3, `read ${pulled} chunks`);
  assertEquals(calls, []);
});

Deno.test("past the limit the reader waits for the window's end, and the PMS is not asked", async () => {
  const { deps, calls } = world({
    takeRead: (userId) => {
      calls.push(`take ${userId}`);
      return Promise.resolve(false);
    },
  });

  const response = await createReviewTextHandler(deps)(post());

  assertEquals(response.status, 429);
  assertEquals(await hintOf(response), "serverErrors.reviewTextLimit");
  // 10:03:20 → the window of ten minutes ends at 10:10:00.
  assertEquals(response.headers.get("Retry-After"), "400");
  assertEquals(calls, [`take ${MANAGER.id}`]);
});

Deno.test("without its counter the function reads nothing", async () => {
  const { deps, calls } = world({ takeRead: () => Promise.reject(new Error("PGRST202")) });

  const response = await createReviewTextHandler(deps)(post());

  assertEquals(response.status, 503);
  assertEquals(await hintOf(response), "serverErrors.reviewTextUnavailable");
  assertEquals(calls, []);
});

Deno.test("a review past its 18 months, or of a PMS this function cannot read, is not looked for", async () => {
  const purged = world({ findReview: () => Promise.resolve({ ...STORED, externalKey: `purged:${SIGNAL_ID}` }) });
  const gone = await createReviewTextHandler(purged.deps)(post());
  assertEquals(gone.status, 410);
  assertEquals(await hintOf(gone), "serverErrors.reviewTextGone");
  assert(!purged.calls.some((call) => call.startsWith("list")));

  const other = world({ findReview: () => Promise.resolve({ ...STORED, provider: "fake" }) });
  assertEquals((await createReviewTextHandler(other.deps)(post())).status, 404);
});

Deno.test("a PMS that fails says so by a code; its words go neither back nor into the log", async () => {
  const quoted = "Hostaway rejected request reviews: SYNTH-REVIEW-TEXT Synthia Reviewer";
  const { deps, logs } = world({ listReviews: () => Promise.reject(new HostawayError(quoted)) });

  const response = await createReviewTextHandler(deps)(post());

  assertEquals(response.status, 502);
  const text = await response.text();
  assertNoGuestWords(text);
  assertNoGuestWords(logs.join("\n"));
  assertEquals(logs, ["guest-review-text source_unavailable in 0 ms"]);
});

Deno.test("an unexpected failure is answered and logged by its name only", async () => {
  const { deps, logs } = world({
    findReview: () => Promise.reject(new TypeError("SYNTH-REVIEW-TEXT in a message")),
  });

  const response = await createReviewTextHandler(deps)(post());

  assertEquals(response.status, 500);
  assertNoGuestWords(await response.text());
  assertEquals(logs, ["guest-review-text failed:TypeError in 0 ms"]);
});

Deno.test("the browser's preflight is answered, and only POST is served", async () => {
  const { deps } = world();
  const handler = createReviewTextHandler(deps);

  const preflight = await handler(new Request("http://x/guest-review-text", { method: "OPTIONS" }));
  assertEquals(preflight.status, 204);
  assertEquals(preflight.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");

  const get = await handler(new Request("http://x/guest-review-text", { method: "GET" }));
  assertEquals(get.status, 405);
  assertEquals(get.headers.get("Allow"), "POST");
});
