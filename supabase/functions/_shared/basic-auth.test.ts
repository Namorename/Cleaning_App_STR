import { assertEquals } from "jsr:@std/assert@1";
import { AUTH_SCHEME, buildBasicAuthHeader, verifyBasicAuth } from "./basic-auth.ts";

const EXPECTED = { login: "hostaway-hook", password: "s3cret-p@ss" } as const;

function header(login: string, password: string): string {
  return buildBasicAuthHeader(login, password);
}

Deno.test("верные учётные данные принимаются", async () => {
  const result = await verifyBasicAuth(header(EXPECTED.login, EXPECTED.password), EXPECTED);
  assertEquals(result, { ok: true });
});

// ---------------------------------------------------------------------------
//  Причины отказа различаются: от них зависит код ответа и, значит,
//  повторит ли Hostaway доставку или потеряет событие навсегда.
// ---------------------------------------------------------------------------

Deno.test("заголовка нет вовсе", async () => {
  // Так выглядит вебхук, зарегистрированный в Hostaway без логина и пароля.
  assertEquals(await verifyBasicAuth(null, EXPECTED), { ok: false, reason: "missing" });
  assertEquals(await verifyBasicAuth("", EXPECTED), { ok: false, reason: "missing" });
});

Deno.test("чужая схема авторизации", async () => {
  const result = await verifyBasicAuth("Bearer eyJhbGciOi", EXPECTED);
  assertEquals(result, { ok: false, reason: "malformed" });
});

Deno.test("схема распознаётся без учёта регистра", async () => {
  const encoded = btoa(`${EXPECTED.login}:${EXPECTED.password}`);
  assertEquals(await verifyBasicAuth(`basic ${encoded}`, EXPECTED), { ok: true });
  assertEquals(await verifyBasicAuth(`BASIC ${encoded}`, EXPECTED), { ok: true });
});

Deno.test("испорченный base64", async () => {
  const result = await verifyBasicAuth(`${AUTH_SCHEME} не-base64!!!`, EXPECTED);
  assertEquals(result, { ok: false, reason: "malformed" });
});

Deno.test("в раскодированной строке нет двоеточия", async () => {
  const result = await verifyBasicAuth(`${AUTH_SCHEME} ${btoa("prostotext")}`, EXPECTED);
  assertEquals(result, { ok: false, reason: "malformed" });
});

Deno.test("неверный логин", async () => {
  const result = await verifyBasicAuth(header("chuzhoi", EXPECTED.password), EXPECTED);
  assertEquals(result, { ok: false, reason: "mismatch" });
});

Deno.test("неверный пароль", async () => {
  const result = await verifyBasicAuth(header(EXPECTED.login, "neverniy"), EXPECTED);
  assertEquals(result, { ok: false, reason: "mismatch" });
});

Deno.test("правильный префикс пароля не проходит", async () => {
  // Проверка обязана сравнивать значение целиком, а не до первого расхождения.
  const result = await verifyBasicAuth(header(EXPECTED.login, "s3cret"), EXPECTED);
  assertEquals(result, { ok: false, reason: "mismatch" });
});

Deno.test("пустые учётные данные не проходят", async () => {
  assertEquals(await verifyBasicAuth(header("", ""), EXPECTED), { ok: false, reason: "mismatch" });
});

Deno.test("двоеточие внутри пароля не ломает разбор", async () => {
  // RFC 7617: логин двоеточий не содержит, пароль — может.
  const tricky = { login: "hook", password: "a:b:c" } as const;
  assertEquals(await verifyBasicAuth(header(tricky.login, tricky.password), tricky), { ok: true });
});

Deno.test("пароль из юникода переживает кодирование", async () => {
  const unicode = { login: "хук", password: "пароль-Ω" } as const;
  const built = buildBasicAuthHeader(unicode.login, unicode.password);
  assertEquals(await verifyBasicAuth(built, unicode), { ok: true });
});

Deno.test("подмена логина и пароля местами не проходит", async () => {
  const result = await verifyBasicAuth(header(EXPECTED.password, EXPECTED.login), EXPECTED);
  assertEquals(result, { ok: false, reason: "mismatch" });
});

Deno.test("лишние пробелы вокруг заголовка допускаются", async () => {
  const encoded = btoa(`${EXPECTED.login}:${EXPECTED.password}`);
  assertEquals(await verifyBasicAuth(`  ${AUTH_SCHEME}   ${encoded}  `, EXPECTED), { ok: true });
});
