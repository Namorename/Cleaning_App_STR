import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

import { hmacHex } from "../_shared/api-key.ts";
import { type CreateKeyRecord, createKeysHandler, type KeysDeps, readInput } from "./handler.ts";

const PEPPER = "q".repeat(32);
const KEY = `woom_${"C".repeat(43)}`;
const ADMIN = "a2800001-0000-4000-8000-000000000001";
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

function setup(overrides: Partial<KeysDeps> = {}) {
  const records: CreateKeyRecord[] = [];
  const deps: KeysDeps = {
    pepper: PEPPER,
    newKey: () => KEY,
    now: () => NOW,
    logError: () => undefined,
    userIdOf: (token) => Promise.resolve(token === "session" ? ADMIN : null),
    createKey: (record) => {
      records.push(record);
      return Promise.resolve({ data: { id: "k-1", prefix: record.prefix, preset: record.preset }, error: null });
    },
    ...overrides,
  };
  return { handler: createKeysHandler(deps), records };
}

function call(body: unknown, token: string | null = "session"): Request {
  return new Request("http://x/api-keys", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

const FORM = { name: "Agent", preset: "read_only", scopes: [], property_ids: null, expires_in_days: 90 };

Deno.test("no session, or a session that is not one: 401 and nothing made", async () => {
  const { handler, records } = setup();
  assertEquals((await handler(call(FORM, null))).status, 401);
  assertEquals((await handler(call(FORM, "forged"))).status, 401);
  assertEquals(records.length, 0);
});

Deno.test("the key goes back once; the database gets its digest and prefix, never the key", async () => {
  const { handler, records } = setup();
  const response = await handler(call(FORM));
  assertEquals(response.status, 201);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assertEquals(body.data.key, KEY);
  assertEquals(records[0].digest, await hmacHex(PEPPER, KEY));
  assertEquals(records[0].prefix, KEY.slice(0, 12));
  assertEquals(records[0].actorId, ADMIN);
  assert(!JSON.stringify(records).includes(KEY));
});

Deno.test("the expiry is counted from now; null is never", async () => {
  const { handler, records } = setup();
  await handler(call(FORM));
  await handler(call({ ...FORM, expires_in_days: null }));
  assertEquals(records[0].expiresAt, new Date(NOW + 90 * 86_400_000).toISOString());
  assertEquals(records[1].expiresAt, null);
});

Deno.test("the form is checked for shape before anything is made", () => {
  assertEquals(readInput({ ...FORM, expires_in_days: 7 }), null);
  assertEquals(readInput({ ...FORM, scopes: "all" }), null);
  assertEquals(readInput({ ...FORM, property_ids: [0] }), null);
  assertEquals(readInput({ ...FORM, property_ids: [123456] })?.propertyIds, [123456]);
  assertEquals(readInput([]), null);
});

Deno.test("a refusal of the database goes back in the panel's shape", async () => {
  const { handler } = setup({
    createKey: () =>
      Promise.resolve({
        data: null,
        error: { message: "Scope api_keys:manage may never be granted", hint: "serverErrors.apiScopeForbidden", details: '{"scope":"api_keys:manage"}' },
      }),
  });
  const response = await handler(call({ ...FORM, preset: "custom", scopes: ["api_keys:manage"] }));
  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.error.hint, "serverErrors.apiScopeForbidden");
  assertMatch(body.error.details, /api_keys:manage/);
  assertEquals(body.data, undefined);
});

Deno.test("without a pepper nothing is made", async () => {
  const { handler, records } = setup({ pepper: null });
  assertEquals((await handler(call(FORM))).status, 500);
  assertEquals(records.length, 0);
});
