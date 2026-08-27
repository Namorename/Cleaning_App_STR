import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import {
  HostawayClient,
  MAX_ATTEMPTS,
  MIN_REQUEST_INTERVAL_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
} from "./hostaway.ts";

const CREDENTIALS = { accountId: "37874", apiKey: "test-secret" } as const;

interface RecordedRequest {
  url: string;
  method: string;
  authorization: string | null;
}

/**
 * Стенд с подменёнными fetch, sleep и часами.
 *
 * Задержки не проживаются, а записываются: тест проверяет точную
 * последовательность миллисекунд, а не «что-то подождали».
 */
function makeHarness(responses: Response[], { requestDurationMs = 0 } = {}) {
  const requests: RecordedRequest[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const queue = [...responses];

  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers ?? {});
    requests.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("Authorization"),
    });

    // Реальный запрос занимает время. Стенд по умолчанию мгновенный, но
    // отдельные тесты задают длительность, чтобы проверить: если сеть уже
    // потратила больше интервала, клиент не должен спать сверху.
    clock += requestDurationMs;

    const next = queue.shift();
    if (!next) {
      throw new Error(`Стенд исчерпан: незапланированный запрос ${url}`);
    }
    return Promise.resolve(next);
  };

  const sleep = (ms: number): Promise<void> => {
    sleeps.push(ms);
    clock += ms;
    return Promise.resolve();
  };

  const now = (): number => clock;

  const advance = (ms: number): void => {
    clock += ms;
  };

  return { requests, sleeps, fetchImpl, sleep, now, advance };
}

function tokenResponse(token: string): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: 15_897_600 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function pageResponse(result: unknown[], count = result.length): Response {
  return new Response(JSON.stringify({ status: "success", result, count }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, body = "{}"): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

function makeListings(count: number, startId = 1): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    id: startId + index,
    internalListingName: `CZ - Тестовый ${startId + index}`,
    timeZoneName: "Europe/Prague",
  }));
}

// ---------------------------------------------------------------------------
//  OAuth и обновление токена
// ---------------------------------------------------------------------------

Deno.test("получает токен один раз и переиспользует его между страницами", async () => {
  const harness = makeHarness([
    tokenResponse("token-1"),
    pageResponse(makeListings(2), 2),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  await client.listAll("listings", 100);

  const authCalls = harness.requests.filter((r) => r.url.includes("/accessTokens"));
  assertEquals(authCalls.length, 1, "токен должен запрашиваться ровно один раз");
  assertEquals(authCalls[0].method, "POST");

  const dataCalls = harness.requests.filter((r) => r.url.includes("/listings"));
  assertEquals(dataCalls[0].authorization, "Bearer token-1");
});

Deno.test("после 401 обновляет токен и повторяет запрос уже с новым", async () => {
  const harness = makeHarness([
    tokenResponse("stale-token"),
    errorResponse(401),
    tokenResponse("fresh-token"),
    pageResponse(makeListings(1), 1),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  const rows = await client.listAll("listings", 100);

  assertEquals(rows.length, 1);

  const authCalls = harness.requests.filter((r) => r.url.includes("/accessTokens"));
  assertEquals(authCalls.length, 2, "должно быть два похода за токеном");

  const dataCalls = harness.requests.filter((r) => r.url.includes("/listings"));
  assertEquals(dataCalls.length, 2, "запрос данных должен повториться");
  assertEquals(dataCalls[0].authorization, "Bearer stale-token");
  assertEquals(dataCalls[1].authorization, "Bearer fresh-token", "повтор обязан идти с новым токеном");
});

Deno.test("обновление токена по 401 не тратит попытки backoff", async () => {
  const harness = makeHarness([
    tokenResponse("stale-token"),
    errorResponse(401),
    tokenResponse("fresh-token"),
    pageResponse(makeListings(1), 1),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  await client.listAll("listings", 100);

  // Повтор после 401 — обычный запрос, он честно считается в лимит, поэтому
  // пауза темпа допустима. Недопустимо отступление как при перегрузке.
  const backoffs = harness.sleeps.filter((ms) => ms >= RETRY_BASE_DELAY_MS);
  assertEquals(backoffs, [], `401 — не перегрузка, backoff неуместен: ${harness.sleeps}`);

  const dataCalls = harness.requests.filter((r) => r.url.includes("/listings"));
  assertEquals(dataCalls.length, 2, "повтор после 401 не должен тратить попытки backoff");
});

Deno.test("сдаётся, если 401 повторился уже с новым токеном", async () => {
  const harness = makeHarness([
    tokenResponse("token-a"),
    errorResponse(401),
    tokenResponse("token-b"),
    errorResponse(401),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  const error = await assertRejects(() => client.listAll("listings", 100), Error);
  assertStringIncludes(error.message, "401");

  const authCalls = harness.requests.filter((r) => r.url.includes("/accessTokens"));
  assertEquals(authCalls.length, 2, "второй раз обновлять токен бессмысленно — это цикл");
});

// ---------------------------------------------------------------------------
//  Rate limit: 15 запросов / 10 секунд
// ---------------------------------------------------------------------------

Deno.test("на 429 ждёт с экспоненциальной задержкой и повторяет", async () => {
  const harness = makeHarness([
    tokenResponse("token"),
    errorResponse(429),
    errorResponse(429),
    errorResponse(429),
    pageResponse(makeListings(1), 1),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  const rows = await client.listAll("listings", 100);

  assertEquals(rows.length, 1, "после отступления запрос обязан пройти");
  assertEquals(
    harness.sleeps,
    [RETRY_BASE_DELAY_MS, RETRY_BASE_DELAY_MS * 2, RETRY_BASE_DELAY_MS * 4],
    "задержки должны удваиваться: 2с, 4с, 8с",
  );
});

Deno.test("задержка backoff упирается в потолок и не растёт дальше", async () => {
  const harness = makeHarness([
    tokenResponse("token"),
    ...Array.from({ length: MAX_ATTEMPTS - 1 }, () => errorResponse(429)),
    pageResponse(makeListings(1), 1),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  await client.listAll("listings", 100);

  for (const delay of harness.sleeps) {
    assertEquals(delay <= RETRY_MAX_DELAY_MS, true, `задержка ${delay} превысила потолок`);
  }
  assertEquals(harness.sleeps.length, MAX_ATTEMPTS - 1);
});

Deno.test("исчерпав попытки на 429, бросает ошибку и не молчит", async () => {
  const harness = makeHarness([
    tokenResponse("token"),
    ...Array.from({ length: MAX_ATTEMPTS }, () => errorResponse(429)),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  const error = await assertRejects(() => client.listAll("listings", 100), Error);
  assertStringIncludes(error.message, "429");

  const dataCalls = harness.requests.filter((r) => r.url.includes("/listings"));
  assertEquals(dataCalls.length, MAX_ATTEMPTS, "должно быть ровно столько попыток, сколько задано");
});

Deno.test("выдерживает паузу между подряд идущими запросами", async () => {
  // Лимит Hostaway — 15 запросов за 10 секунд. Без паузы пачка страниц
  // упёрлась бы в 429 на ровном месте.
  const harness = makeHarness([
    tokenResponse("token"),
    pageResponse(makeListings(2), 2),
    pageResponse(makeListings(2, 3), 2),
    pageResponse([], 0),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  await client.listAll("listings", 2);

  const pacing = harness.sleeps.filter((ms) => ms === MIN_REQUEST_INTERVAL_MS);
  assertEquals(
    pacing.length >= 2,
    true,
    `ожидались паузы между страницами, получено ${harness.sleeps}`,
  );
});

Deno.test("не ждёт, если сеть и так потратила больше интервала", async () => {
  // Медленный ответ уже развёл запросы во времени — досыпать сверху незачем.
  const harness = makeHarness(
    [
      tokenResponse("token"),
      pageResponse(makeListings(2), 2),
      pageResponse([], 0),
    ],
    { requestDurationMs: MIN_REQUEST_INTERVAL_MS + 100 },
  );
  const client = new HostawayClient(CREDENTIALS, harness);

  await client.listAll("listings", 2);

  assertEquals(harness.sleeps, [], `лишние задержки: ${harness.sleeps}`);
});

Deno.test("повторяет на 5xx так же, как на 429", async () => {
  const harness = makeHarness([
    tokenResponse("token"),
    errorResponse(503),
    pageResponse(makeListings(1), 1),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  const rows = await client.listAll("listings", 100);

  assertEquals(rows.length, 1);
  assertEquals(harness.sleeps.includes(RETRY_BASE_DELAY_MS), true);
});

// ---------------------------------------------------------------------------
//  Пагинация через offset
// ---------------------------------------------------------------------------

Deno.test("проходит страницы через offset и останавливается на неполной", async () => {
  const harness = makeHarness([
    tokenResponse("token"),
    pageResponse(makeListings(3, 1), 3),
    pageResponse(makeListings(3, 4), 3),
    pageResponse(makeListings(1, 7), 1),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  const rows = await client.listAll("listings", 3);

  assertEquals(rows.length, 7, "все страницы должны склеиться");

  const offsets = harness.requests
    .filter((r) => r.url.includes("/listings"))
    .map((r) => new URL(r.url).searchParams.get("offset"));
  assertEquals(offsets, ["0", "3", "6"], "offset обязан расти на размер страницы");
});

Deno.test("останавливается на пустой странице, не запрашивая следующую", async () => {
  const harness = makeHarness([
    tokenResponse("token"),
    pageResponse(makeListings(2, 1), 2),
    pageResponse([], 0),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  const rows = await client.listAll("listings", 2);

  assertEquals(rows.length, 2);
  const dataCalls = harness.requests.filter((r) => r.url.includes("/listings"));
  assertEquals(dataCalls.length, 2);
});

// ---------------------------------------------------------------------------
//  Ошибки уровня приложения
// ---------------------------------------------------------------------------

Deno.test("бросает ошибку на status=fail, пришедшем с кодом 200", async () => {
  // Hostaway умеет отвечать HTTP 200 с телом об ошибке — молча проглотить нельзя.
  const harness = makeHarness([
    tokenResponse("token"),
    new Response(JSON.stringify({ status: "fail", result: "Invalid scope" }), { status: 200 }),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  const error = await assertRejects(() => client.listAll("listings", 100), Error);
  assertStringIncludes(error.message, "Invalid scope");
});

Deno.test("бросает ошибку, если авторизация не удалась", async () => {
  const harness = makeHarness([errorResponse(403, '{"error":"invalid_client"}')]);
  const client = new HostawayClient(CREDENTIALS, harness);

  const error = await assertRejects(() => client.listAll("listings", 100), Error);
  assertStringIncludes(error.message, "403");
});

Deno.test("бросает ошибку, если result пришёл не массивом", async () => {
  const harness = makeHarness([
    tokenResponse("token"),
    new Response(JSON.stringify({ status: "success", result: { id: 1 } }), { status: 200 }),
  ]);
  const client = new HostawayClient(CREDENTIALS, harness);

  await assertRejects(() => client.listAll("listings", 100), Error);
});
