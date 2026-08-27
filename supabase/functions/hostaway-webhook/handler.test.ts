import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildBasicAuthHeader } from "../_shared/basic-auth.ts";
import { ConfigError } from "../_shared/env.ts";
import { createWebhookHandler } from "./handler.ts";

const CREDENTIALS = { login: "hostaway-hook", password: "s3cret-p@ss" } as const;
const AUTH = buildBasicAuthHeader(CREDENTIALS.login, CREDENTIALS.password);

const RESERVATION_EVENT = {
  object: "reservation",
  objectId: 65289672,
  event: "reservation.created",
};

function makeHandler(options: { credentialsError?: Error; recordError?: Error } = {}) {
  const recorded: unknown[] = [];
  let nextId = 1;

  const handler = createWebhookHandler({
    loadCredentials: () => {
      if (options.credentialsError) throw options.credentialsError;
      return CREDENTIALS;
    },
    recordEvent: (payload: unknown) => {
      if (options.recordError) return Promise.reject(options.recordError);
      recorded.push(payload);
      return Promise.resolve(nextId++);
    },
  });

  return { handler, recorded };
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/functions/v1/hostaway-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
//  Успешный путь
// ---------------------------------------------------------------------------

Deno.test("верные данные: 200 и событие в журнале", async () => {
  const { handler, recorded } = makeHandler();

  const response = await handler(request(RESERVATION_EVENT, { Authorization: AUTH }));

  assertEquals(response.status, 200);
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0], RESERVATION_EVENT);
});

Deno.test("неизвестный тип события всё равно принимается", async () => {
  // Документация Hostaway: «if you receive a webhook with an event that you
  // don't support yet, just return a 200 response».
  const { handler, recorded } = makeHandler();

  const response = await handler(
    request({ object: "somethingNew", objectId: 1, event: "future.event" }, { Authorization: AUTH }),
  );

  assertEquals(response.status, 200);
  assertEquals(recorded.length, 1, "неизвестное событие тоже нужно сохранить");
});

// ---------------------------------------------------------------------------
//  Отказы авторизации: 401, повтора не будет — и это правильно
// ---------------------------------------------------------------------------

Deno.test("без заголовка: 401 и ничего не записано", async () => {
  const { handler, recorded } = makeHandler();

  const response = await handler(request(RESERVATION_EVENT));

  assertEquals(response.status, 401);
  assertEquals(recorded.length, 0, "неавторизованное событие в журнал попадать не должно");
});

Deno.test("неверный пароль: 401", async () => {
  const { handler, recorded } = makeHandler();
  const wrong = buildBasicAuthHeader(CREDENTIALS.login, "neverniy");

  const response = await handler(request(RESERVATION_EVENT, { Authorization: wrong }));

  assertEquals(response.status, 401);
  assertEquals(recorded.length, 0);
});

Deno.test("битый заголовок: 401", async () => {
  const { handler } = makeHandler();

  const response = await handler(request(RESERVATION_EVENT, { Authorization: "Bearer abc" }));

  assertEquals(response.status, 401);
});

Deno.test("ответ 401 несёт WWW-Authenticate", async () => {
  const { handler } = makeHandler();

  const response = await handler(request(RESERVATION_EVENT));

  assertStringIncludes(response.headers.get("WWW-Authenticate") ?? "", "Basic");
});

// ---------------------------------------------------------------------------
//  Наши собственные сбои: 500, потому что 5xx Hostaway повторяет
// ---------------------------------------------------------------------------

Deno.test("секреты не настроены: 500, а НЕ 401", async () => {
  // Ключевое место. Забытый секрет при развёртывании — наша ошибка, и она
  // обязана быть повторяемой: 5xx Hostaway переспросит в течение часа,
  // 4xx выбросил бы бронь навсегда.
  const { handler, recorded } = makeHandler({
    credentialsError: new ConfigError("Не заданы переменные окружения: HOSTAWAY_WEBHOOK_LOGIN"),
  });

  const response = await handler(request(RESERVATION_EVENT, { Authorization: AUTH }));

  assertEquals(response.status, 500);
  assertEquals(recorded.length, 0);
});

Deno.test("секреты не настроены и заголовка нет: всё равно 500", async () => {
  // Проверка конфигурации идёт ДО проверки заголовка, иначе развёртывание
  // без секретов маскировалось бы под неавторизованный запрос.
  const { handler } = makeHandler({ credentialsError: new ConfigError("нет секретов") });

  const response = await handler(request(RESERVATION_EVENT));

  assertEquals(response.status, 500);
});

Deno.test("запись в журнал упала: 500", async () => {
  // Транзиентный сбой базы. Hostaway повторит — событие не потеряется.
  const { handler } = makeHandler({ recordError: new Error("connection reset") });

  const response = await handler(request(RESERVATION_EVENT, { Authorization: AUTH }));

  assertEquals(response.status, 500);
});

// ---------------------------------------------------------------------------
//  Нечитаемое тело: принимаем и сохраняем как есть
// ---------------------------------------------------------------------------

Deno.test("невалидный JSON: 200 и сырой текст в журнале", async () => {
  // Повтор такого не исправит, но и терять нельзя: сохраняем как есть,
  // чтобы разобраться вручную.
  const { handler, recorded } = makeHandler();

  const response = await handler(request("{это не json", { Authorization: AUTH }));

  assertEquals(response.status, 200);
  assertEquals(recorded.length, 1);
  const payload = recorded[0] as Record<string, unknown>;
  assertEquals(typeof payload.unparsed, "string");
  assertStringIncludes(payload.unparsed as string, "это не json");
});

Deno.test("пустое тело: 200 и отметка в журнале", async () => {
  const { handler, recorded } = makeHandler();

  const response = await handler(request("", { Authorization: AUTH }));

  assertEquals(response.status, 200);
  assertEquals(recorded.length, 1);
});

// ---------------------------------------------------------------------------
//  Прочее
// ---------------------------------------------------------------------------

Deno.test("не-POST отвергается с 405", async () => {
  const { handler, recorded } = makeHandler();

  const response = await handler(
    new Request("https://example.test/functions/v1/hostaway-webhook", {
      method: "GET",
      headers: { Authorization: AUTH },
    }),
  );

  assertEquals(response.status, 405);
  assertEquals(recorded.length, 0);
});

Deno.test("ответ короткий: подтверждение и номер записи", async () => {
  // Hostaway ждёт подтверждения 20 секунд; разбор идёт отдельно, поэтому
  // ответ должен быть коротким.
  const { handler } = makeHandler();

  const response = await handler(request(RESERVATION_EVENT, { Authorization: AUTH }));
  const body = await response.json();

  assertEquals(body.accepted, true);
  assertEquals(typeof body.eventId, "number");
});
