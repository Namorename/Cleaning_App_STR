import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

import { HostawayClient, HostawayError } from "../_shared/hostaway.ts";
import { fakeHostawayApi, HOSTAWAY_GUEST_WORDS, hostawayMessage } from "../_shared/signals/hostaway-fake-api.ts";
import { createSignalKeyer } from "../_shared/signals/key.ts";
import { ANSWER_TTL_MS, MessageAnswerCache } from "./cache.ts";
import {
  type Caller,
  CONTEXT_WINDOW_MS,
  createMessageTextHandler,
  type GuestMessage,
  MAX_TEXT_CHARS,
  type MessageTextDeps,
  messagesAround,
  READS_PER_WINDOW,
  readTarget,
  type Target,
} from "./handler.ts";
import { ConversationGoneError, listConversationMessages } from "./pms.ts";

// Synthetic only: the messages are the fake PMS's, the key secret is the tests'.
const SECRET = "test-only-signal-key-secret-0123456789abcdef";
const keyOf = await createSignalKeyer("hostaway", "message", SECRET);

/** The panel's production address. */
const PANEL = "https://woom-bnb.vercel.app";

const HOST_ID = "11111111-1111-4111-8111-111111111111";
const PROBLEM_ID = "22222222-2222-4222-8222-222222222222";
const FINDING_ID = "44444444-4444-4444-8444-444444444444";
const HEAD: Caller = { id: "33333333-3333-4333-8333-333333333333", role: "head_tech", hostId: HOST_ID, isActive: true };

const CONVERSATION = "61000001";
/** The guest wrote at 14:00; the card was raised on it. */
const FLAGGED = hostawayMessage(81000003, 61000001, "2026-11-10 14:00:00", {
  body: "SYNTH-GUEST-TEXT: there is no hot water in the shower.",
});
/** The guest, a little before: context. */
const BEFORE = hostawayMessage(81000002, 61000001, "2026-11-10 13:50:00", { body: "SYNTH-GUEST-TEXT: hello?" });
/** The company's reply in between: never shown. */
const REPLY = hostawayMessage(81000004, 61000001, "2026-11-10 14:05:00", {
  isIncoming: 0,
  body: "SYNTH-NESTED-TEXT: we are sending someone, Synthia.",
});
/** The guest, a photo a little after: context, without words. */
const AFTER = hostawayMessage(81000005, 61000001, "2026-11-10 14:20:00", { body: "", imagesUrls: ["x", "y"] });
/** The guest, the day before: outside the two hours. */
const YESTERDAY = hostawayMessage(81000001, 61000001, "2026-11-09 18:00:00", { body: "SYNTH-GUEST-TEXT: arrived." });

const MESSAGES = [YESTERDAY, BEFORE, FLAGGED, REPLY, AFTER];

const TARGET: Extract<Target, { status: "ok" }> = {
  status: "ok",
  provider: "hostaway",
  conversationId: CONVERSATION,
  messageId: "81000003",
  messageKey: await keyOf("81000003"),
};

interface World {
  readonly deps: MessageTextDeps;
  readonly logs: string[];
  readonly calls: string[];
}

function world(overrides: Partial<MessageTextDeps> = {}): World {
  const logs: string[] = [];
  const calls: string[] = [];
  const deps: MessageTextDeps = {
    identify: (token) => Promise.resolve(token === "session" ? HEAD : null),
    takeRead: (userId) => {
      calls.push(`take ${userId}`);
      return Promise.resolve(true);
    },
    findTarget: (userId, ask) => {
      calls.push(`find ${userId} ${"problemId" in ask ? `task ${ask.problemId}` : `card ${ask.findingId}`}`);
      return Promise.resolve(TARGET);
    },
    listMessages: (conversationId) => {
      calls.push(`list ${conversationId}`);
      return Promise.resolve(MESSAGES);
    },
    keyOf,
    now: () => Date.parse("2026-11-11T10:03:20Z"),
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, logs, calls };
}

function post(body: unknown = { problem_id: PROBLEM_ID }, token: string | null = "session", origin?: string): Request {
  return new Request("http://x/guest-message-text", {
    method: "POST",
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...(origin === undefined ? {} : { Origin: origin }),
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

/** A log line names the outcome and the time, nothing else. */
function assertCodeOnly(logs: readonly string[]): void {
  for (const line of logs) {
    assert(/^guest-message-text [a-z_]+(:[A-Za-z]+)? in \d+ ms$/.test(line), line);
    assertNoGuestWords(line);
    assert(!line.includes(CONVERSATION) && !line.includes("8100000"), line);
  }
}

// --------------------------------------------------------------- the answer

Deno.test("the head technician gets the flagged message and the guest's words around it, nothing else", async () => {
  const { deps, logs, calls } = world();
  const response = await createMessageTextHandler(deps)(post());

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  const raw = await response.text();
  const { data } = JSON.parse(raw) as { data: { messages: GuestMessage[] } };
  assertEquals(data.messages, [
    { sent_at: "2026-11-10T13:50:00.000Z", text: "SYNTH-GUEST-TEXT: hello?", attachments: 0, is_flagged: false },
    {
      sent_at: "2026-11-10T14:00:00.000Z",
      text: "SYNTH-GUEST-TEXT: there is no hot water in the shower.",
      attachments: 0,
      is_flagged: true,
    },
    { sent_at: "2026-11-10T14:20:00.000Z", text: null, attachments: 2, is_flagged: false },
  ]);
  // The company's reply, the day before, the ids of the PMS: none of them leaves.
  assert(!raw.includes("SYNTH-NESTED-TEXT") && !raw.includes("Synthia") && !raw.includes("arrived"));
  assert(!raw.includes(CONVERSATION) && !raw.includes("81000003") && !raw.includes("80000001"));
  assertEquals(calls, [`take ${HEAD.id}`, `find ${HEAD.id} task ${PROBLEM_ID}`, `list ${CONVERSATION}`]);
  assertEquals(logs, ["guest-message-text ok in 0 ms"]);
});

Deno.test("a card of «Гости» is asked by its id", async () => {
  const { deps, calls } = world();
  const response = await createMessageTextHandler(deps)(post({ finding_id: FINDING_ID }));
  assertEquals(response.status, 200);
  assertEquals(calls[1], `find ${HEAD.id} card ${FINDING_ID}`);
});

Deno.test("a message whose id is gone is found by its key", async () => {
  const messages = await messagesAround(MESSAGES, { ...TARGET, messageId: null }, keyOf);
  assertEquals(messages?.find((m) => m.is_flagged)?.sent_at, "2026-11-10T14:00:00.000Z");
});

Deno.test("at most three messages, the nearest of the guest's within two hours, in the order sent", async () => {
  const at = Date.parse("2026-11-10T14:00:00Z");
  const near = [-110, -30, -5, 10, 40, 125].map((minutes, i) =>
    hostawayMessage(
      81000100 + i,
      61000001,
      new Date(at + minutes * 60_000).toISOString().replace("T", " ").slice(0, 19),
    )
  );
  const messages = await messagesAround([...near, FLAGGED], TARGET, keyOf);
  assertEquals(messages?.map((m) => m.sent_at), [
    "2026-11-10T13:55:00.000Z",
    "2026-11-10T14:00:00.000Z",
    "2026-11-10T14:10:00.000Z",
  ]);
  // Two hours and five minutes away is outside the window, however few others there are.
  const far = await messagesAround([near[5], FLAGGED], TARGET, keyOf);
  assertEquals(far?.length, 1);
  assertEquals(CONTEXT_WINDOW_MS, 2 * 60 * 60 * 1000);
});

Deno.test("a long message is cut, an odd row is passed over, another conversation's row is not read", async () => {
  const long = hostawayMessage(81000003, 61000001, "2026-11-10 14:00:00", { body: "x".repeat(MAX_TEXT_CHARS + 50) });
  const stray = hostawayMessage(81000006, 61000099, "2026-11-10 14:01:00", { body: "SYNTH-GUEST-TEXT: elsewhere" });
  const messages = await messagesAround([null, { id: "x" }, stray, long], TARGET, keyOf);
  assertEquals(messages?.length, 1);
  assertEquals(messages?.[0].text?.length, MAX_TEXT_CHARS + 1);
});

Deno.test("the company's own message is never the flagged one", async () => {
  const messages = await messagesAround(MESSAGES, { ...TARGET, messageId: "81000004", messageKey: null }, keyOf);
  assertEquals(messages, null);
});

// ------------------------------------------------------------- who and how

Deno.test("only the office and the head technician read: a technician, a maid, a deactivated head never", async () => {
  for (
    const caller of [
      { ...HEAD, role: "tech" },
      { ...HEAD, role: "cleaner" },
      { ...HEAD, isActive: false },
    ]
  ) {
    const { deps, calls } = world({ identify: () => Promise.resolve(caller) });
    const response = await createMessageTextHandler(deps)(post());
    assertEquals(response.status, 403);
    assertEquals(await hintOf(response), "serverErrors.guestMessageForbidden");
    assertEquals(calls, [], "nothing is counted or looked up");
  }
  for (const role of ["manager", "admin"]) {
    const { deps } = world({ identify: () => Promise.resolve({ ...HEAD, role }) });
    assertEquals((await createMessageTextHandler(deps)(post())).status, 200, role);
  }
});

Deno.test("no token, or nobody's: not signed in", async () => {
  for (const token of [null, "stolen"]) {
    const { deps, calls } = world();
    const response = await createMessageTextHandler(deps)(post(undefined, token));
    assertEquals(response.status, 401);
    assertEquals(await hintOf(response), "serverErrors.notSignedIn");
    assertEquals(calls, []);
  }
});

Deno.test("a body that names no task or card, or both, is refused before anything is counted", async () => {
  for (
    const body of [
      {},
      { problem_id: "not-a-uuid" },
      { problem_id: PROBLEM_ID, finding_id: FINDING_ID },
      "not json",
      [PROBLEM_ID],
      { problem_id: "x".repeat(2000) },
    ]
  ) {
    const { deps, calls } = world();
    const response = await createMessageTextHandler(deps)(post(body));
    assertEquals(response.status, 400, JSON.stringify(body).slice(0, 40));
    assertEquals(calls, []);
  }
});

Deno.test("past the limit: refused with the limit, nothing looked up", async () => {
  const { deps, calls } = world({ takeRead: () => Promise.resolve(false) });
  const response = await createMessageTextHandler(deps)(post());
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "400");
  const body = await response.json();
  assertEquals(body.error.hint, "serverErrors.guestMessageLimit");
  assertEquals(JSON.parse(body.error.details), { limit: READS_PER_WINDOW, minutes: 10 });
  assertEquals(calls, []);
});

Deno.test("no counter, no read", async () => {
  const { deps, calls } = world({ takeRead: () => Promise.reject(new Error("down")) });
  const response = await createMessageTextHandler(deps)(post());
  assertEquals(response.status, 503);
  assertEquals(await hintOf(response), "serverErrors.guestMessageUnavailable");
  assertEquals(calls, []);
});

Deno.test("the database's answer: forbidden, not found, expired, another PMS", async () => {
  const cases: Array<[Target, number, string]> = [
    [{ status: "forbidden" }, 403, "serverErrors.guestMessageForbidden"],
    [{ status: "not_found" }, 404, "serverErrors.guestMessageNotFound"],
    [{ status: "expired" }, 410, "serverErrors.guestMessageGone"],
    [{ ...TARGET, provider: "other" }, 404, "serverErrors.guestMessageNotFound"],
  ];
  for (const [target, status, hint] of cases) {
    const { deps, calls } = world({ findTarget: () => Promise.resolve(target) });
    const response = await createMessageTextHandler(deps)(post());
    assertEquals(response.status, status, target.status);
    assertEquals(await hintOf(response), hint);
    assert(!calls.some((call) => call.startsWith("list")), "Hostaway is not asked");
  }
});

Deno.test("Hostaway down: «try later», its words never quoted, nothing kept", async () => {
  const quoted = "Hostaway returned HTTP 500 for SYNTH-GUEST-TEXT Synthia";
  const answers = new MessageAnswerCache({ schedule: () => () => {} });
  const { deps, logs } = world({ listMessages: () => Promise.reject(new HostawayError(quoted)), answers });
  const response = await createMessageTextHandler(deps)(post());
  assertEquals(response.status, 502);
  const raw = await response.text();
  assert(raw.includes("serverErrors.guestMessageUnavailable"));
  assertNoGuestWords(raw);
  assertEquals(answers.size, 0);
  assertEquals(logs, ["guest-message-text source_unavailable in 0 ms"]);
});

Deno.test("a conversation or a message Hostaway no longer has: not found", async () => {
  const gone = world({ listMessages: () => Promise.reject(new ConversationGoneError("gone")) });
  const response = await createMessageTextHandler(gone.deps)(post());
  assertEquals(response.status, 404);
  assertEquals(await hintOf(response), "serverErrors.guestMessageNotFound");

  const missing = world({ listMessages: () => Promise.resolve([YESTERDAY, REPLY]) });
  const second = await createMessageTextHandler(missing.deps)(post());
  assertEquals(second.status, 404);
  assertEquals(missing.logs, ["guest-message-text not_in_pms in 0 ms"]);
});

Deno.test("a failure of our own says its name only", async () => {
  const { deps, logs } = world({ findTarget: () => Promise.reject(new TypeError("SYNTH-GUEST-TEXT")) });
  const response = await createMessageTextHandler(deps)(post());
  assertEquals(response.status, 500);
  assertNoGuestWords(await response.text());
  assertEquals(logs, ["guest-message-text failed:TypeError in 0 ms"]);
});

// ------------------------------------------------------------- memory and logs

Deno.test("the same message asked again within three minutes is answered from memory, and not after", async () => {
  let now = Date.parse("2026-11-11T10:00:00Z");
  const answers = new MessageAnswerCache({ schedule: () => () => {} });
  const { deps, calls, logs } = world({ answers, now: () => now });
  const handler = createMessageTextHandler(deps);

  assertEquals((await handler(post())).status, 200);
  now += ANSWER_TTL_MS - 1;
  assertEquals((await handler(post())).status, 200);
  now += 2;
  assertEquals((await handler(post())).status, 200);

  assertEquals(calls.filter((call) => call.startsWith("list")).length, 2);
  assertEquals(calls.filter((call) => call.startsWith("take")).length, 3, "every read is counted");
  assertEquals(logs.map((line) => line.split(" ")[1]), ["ok", "ok_kept", "ok"]);
  assertEquals(ANSWER_TTL_MS, 3 * 60 * 1000);
});

Deno.test("memory holds a few dozen answers at most, the oldest goes first, a timer drops each", () => {
  const drops: Array<() => void> = [];
  const cache = new MessageAnswerCache({ max: 2, schedule: (drop) => (drops.push(drop), () => {}) });
  cache.set("a", [], 0);
  cache.set("b", [], 0);
  cache.set("c", [], 0);
  assertEquals([cache.get("a", 1), cache.size], [undefined, 2]);
  drops[2]();
  assertEquals(cache.get("c", 1), undefined);
});

Deno.test("every log line is a code and a time: no text, no name, no id", async () => {
  const lines: string[] = [];
  for (
    const overrides of [
      {},
      { takeRead: () => Promise.resolve(false) },
      { findTarget: () => Promise.resolve({ status: "expired" } as Target) },
      { listMessages: () => Promise.reject(new HostawayError("SYNTH-GUEST-TEXT")) },
    ] as Partial<MessageTextDeps>[]
  ) {
    const { deps, logs } = world(overrides);
    await createMessageTextHandler(deps)(post());
    lines.push(...logs);
  }
  assertEquals(lines.length, 4);
  assertCodeOnly(lines);
});

// ------------------------------------------------------------- from where

Deno.test("another page is refused before anything, with no CORS header", async () => {
  for (const origin of ["https://evil.example", "https://woom-bnb.vercel.app.evil.example", "null"]) {
    const { deps, calls, logs } = world();
    const response = await createMessageTextHandler(deps)(post(undefined, "session", origin));
    assertEquals(response.status, 403, origin);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(calls, []);
    assertEquals(logs, ["guest-message-text foreign_origin in 0 ms"]);
  }
});

Deno.test("the panel's pages get their own origin back; the phone sends none and is answered", async () => {
  for (const origin of [PANEL, "https://woom-a1b2c3d4e-namorename.vercel.app", "http://localhost:3000"]) {
    const { deps } = world();
    const response = await createMessageTextHandler(deps)(post(undefined, "session", origin));
    assertEquals(response.status, 200, origin);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), origin);
    assertEquals(response.headers.get("Vary"), "Origin");
  }
  const phone = world();
  const response = await createMessageTextHandler(phone.deps)(post());
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("a preflight from the panel is answered without a token; any other method is refused", async () => {
  const { deps, calls } = world();
  const handler = createMessageTextHandler(deps);
  const preflight = await handler(new Request("http://x/", { method: "OPTIONS", headers: { Origin: PANEL } }));
  assertEquals(preflight.status, 204);
  assertEquals(preflight.headers.get("Access-Control-Allow-Origin"), PANEL);
  const get = await handler(new Request("http://x/", { method: "GET", headers: { Authorization: "Bearer session" } }));
  assertEquals(get.status, 405);
  assertEquals(calls, []);
});

// ------------------------------------------------------------- the pieces

Deno.test("the database's answer is read field by field", () => {
  assertEquals(readTarget({ status: "expired" }), { status: "expired" });
  assertEquals(readTarget({ status: "forbidden" }), { status: "forbidden" });
  assertEquals(readTarget(null), { status: "not_found" });
  assertEquals(readTarget({ status: "ok" }), { status: "not_found" });
  assertEquals(
    readTarget({ status: "ok", provider: "hostaway", conversation_id: "61000001", message_id: null, message_key: "ab" }),
    { status: "ok", provider: "hostaway", conversationId: "61000001", messageId: null, messageKey: "ab" },
  );
});

Deno.test("the conversation is asked of Hostaway by a GET; a 404 or a wrong id is «gone»", async () => {
  const api = fakeHostawayApi({
    messages: { [CONVERSATION]: MESSAGES },
    failures: {
      "conversations/61000404/messages": { status: 404 },
      "conversations/61000009/messages": { status: 500 },
    },
  });
  const client = new HostawayClient(
    { accountId: "1", apiKey: "test-only-key" },
    { fetchImpl: api.fetchImpl, sleep: () => Promise.resolve(), now: () => 0 },
  );

  assertEquals((await listConversationMessages(client, CONVERSATION)).length, MESSAGES.length);
  assertEquals(new URL(`http://x/${api.requests[0]}`).pathname, `/conversations/${CONVERSATION}/messages`);

  await assertRejects(() => listConversationMessages(client, "61000404"), ConversationGoneError);
  await assertRejects(() => listConversationMessages(client, "../reservations"), ConversationGoneError);
  await assertRejects(() => listConversationMessages(client, "61000009"), HostawayError);
  assert(!api.requests.some((r) => r.includes("reservations")), "a wrong id never reaches the network");
});

Deno.test("the limit the screens are told is the counter's own", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../migrations/20261111140000_guest_message_text.sql", import.meta.url),
  );
  const counter = migration.slice(migration.indexOf("function public.take_message_text_read"));
  const limit = /c_limit\s+constant integer := (\d+);/.exec(counter)?.[1];
  assertEquals(Number(limit), READS_PER_WINDOW);
  assertEquals(READS_PER_WINDOW, 60);
  const window = /extract\(epoch from now\(\)\) \/ (\d+)\)/.exec(counter)?.[1];
  assertEquals(Number(window), 10 * 60);
});
