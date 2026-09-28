import { assertEquals, assertRejects } from "jsr:@std/assert@1";

import {
  EXPO_RECEIPTS_URL,
  EXPO_SEND_URL,
  type ExpoMessage,
  ExpoPushClient,
  ExpoRequestError,
  ExpoUnavailableError,
} from "./expo.ts";

/**
 * The Expo Push API as the function uses it: messages in, one ticket per
 * message back; tickets in, receipts back. 429 and 5xx are waited out with a
 * growing pause, a request Expo refuses is not repeated.
 */

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function recording(answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    const answer = answers.shift() ?? new Error("no answer left");
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const message = (to: string): ExpoMessage => ({
  to,
  title: "t",
  body: "b",
  data: { kind: "cleaning_assigned" },
  sound: "default",
  priority: "high",
  channelId: "general",
  interruptionLevel: "active",
  collapseId: "task:1",
  tag: "task:1",
  threadId: "task:1",
  ttl: 60,
});

const noSleep = () => Promise.resolve();

Deno.test("sends the messages with the project's access token and returns one ticket each", async () => {
  // Arrange
  const { calls, fetchImpl } = recording([
    json({
      data: [
        { status: "ok", id: "tk-1" },
        { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
      ],
    }),
  ]);
  const client = new ExpoPushClient({ fetchImpl, sleep: noSleep, accessToken: "secret" });

  // Act
  const tickets = await client.send([message("A"), message("B")]);

  // Assert
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, EXPO_SEND_URL);
  assertEquals(calls[0].headers.authorization, "Bearer secret");
  assertEquals((calls[0].body as ExpoMessage[]).map((m) => m.to), ["A", "B"]);
  assertEquals(tickets, [
    { status: "ok", id: "tk-1" },
    { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
  ]);
});

Deno.test("without an access token no authorization header is sent", async () => {
  const { calls, fetchImpl } = recording([json({ data: [{ status: "ok", id: "tk-1" }] })]);
  const client = new ExpoPushClient({ fetchImpl, sleep: noSleep, accessToken: null });

  await client.send([message("A")]);

  assertEquals(calls[0].headers.authorization, undefined);
});

Deno.test("a busy or failing Expo is waited out with a growing pause", async () => {
  // Arrange
  const pauses: number[] = [];
  const { calls, fetchImpl } = recording([
    json({ errors: [{ code: "TOO_MANY_REQUESTS" }] }, 429),
    json({}, 503),
    new TypeError("connection reset"),
    json({ data: [{ status: "ok", id: "tk-1" }] }),
  ]);
  const client = new ExpoPushClient({
    fetchImpl,
    sleep: (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    },
  });

  // Act
  const tickets = await client.send([message("A")]);

  // Assert
  assertEquals(calls.length, 4);
  assertEquals(pauses, [1_000, 2_000, 4_000]);
  assertEquals(tickets, [{ status: "ok", id: "tk-1" }]);
});

Deno.test("an Expo that stays down is reported as unavailable", async () => {
  const { fetchImpl } = recording([json({}, 502), json({}, 502), json({}, 502), json({}, 502)]);
  const client = new ExpoPushClient({ fetchImpl, sleep: noSleep });

  await assertRejects(() => client.send([message("A")]), ExpoUnavailableError);
});

Deno.test("a request Expo refuses is not repeated", async () => {
  const { calls, fetchImpl } = recording([
    json({ errors: [{ code: "PUSH_TOO_MANY_NOTIFICATIONS", message: "too many" }] }, 400),
  ]);
  const client = new ExpoPushClient({ fetchImpl, sleep: noSleep });

  await assertRejects(
    () => client.send([message("A")]),
    ExpoRequestError,
    "PUSH_TOO_MANY_NOTIFICATIONS",
  );
  assertEquals(calls.length, 1);
});

Deno.test("an answer that does not match the messages is refused rather than guessed at", async () => {
  const { fetchImpl } = recording([json({ data: [{ status: "ok", id: "tk-1" }] })]);
  const client = new ExpoPushClient({ fetchImpl, sleep: noSleep });

  await assertRejects(() => client.send([message("A"), message("B")]), ExpoRequestError);
});

Deno.test("receipts are asked for at most a thousand tickets at a time", async () => {
  // Arrange
  const ids = Array.from({ length: 1_500 }, (_, index) => `tk-${index}`);
  const { calls, fetchImpl } = recording([
    json({ data: { "tk-0": { status: "ok" } } }),
    json({
      data: {
        "tk-1499": { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
      },
    }),
  ]);
  const client = new ExpoPushClient({ fetchImpl, sleep: noSleep });

  // Act
  const receipts = await client.receipts(ids);

  // Assert
  assertEquals(calls.map((call) => call.url), [EXPO_RECEIPTS_URL, EXPO_RECEIPTS_URL]);
  assertEquals(calls.map((call) => (call.body as { ids: string[] }).ids.length), [1_000, 500]);
  assertEquals([...receipts.entries()], [
    ["tk-0", { status: "ok" }],
    ["tk-1499", { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }],
  ]);
});

Deno.test("every request to Expo is bounded in time", async () => {
  const signals: (AbortSignal | null | undefined)[] = [];
  const client = new ExpoPushClient({
    fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      return Promise.resolve(json({ data: [{ status: "ok", id: "tk" }] }));
    }) as typeof fetch,
    sleep: () => Promise.resolve(),
  });

  await client.send([message("A")]);

  assertEquals(signals[0] instanceof AbortSignal, true);
});

Deno.test("with no time left in the run, nothing is sent", async () => {
  let fetched = 0;
  const client = new ExpoPushClient({
    fetchImpl: (() => {
      fetched += 1;
      return Promise.resolve(json({ data: [{ status: "ok", id: "tk" }] }));
    }) as typeof fetch,
    sleep: () => Promise.resolve(),
    now: () => 10_000,
  });

  await assertRejects(() => client.send([message("A")], 5_000), ExpoUnavailableError);
  assertEquals(fetched, 0);
});
