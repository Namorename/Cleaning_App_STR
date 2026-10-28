import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

import { hmacHex } from "../_shared/api-key.ts";
import { type ApiDeps, createApiHandler, type RpcResult } from "./handler.ts";

const PEPPER = "p".repeat(32);
const KEY = `woom_${"A".repeat(43)}`;
const BASE = "http://localhost/api";
const UUID = "6f8d2c1e-5b7a-4e3f-9a10-2b4c6d8e0f12";

interface Call {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

type Rpc = (args: Record<string, unknown>) => RpcResult;

/** A database that answers the gate for KEY and whatever the test says for the rest. */
async function setup(answers: Record<string, Rpc> = {}, overrides: Partial<ApiDeps> = {}) {
  const digest = await hmacHex(PEPPER, KEY);
  const calls: Call[] = [];
  const logs: string[] = [];
  const deferred: Promise<unknown>[] = [];
  const deps: ApiDeps = {
    pepper: PEPPER,
    now: () => 1000,
    newRequestId: () => "11111111-1111-4111-8111-111111111111",
    logError: (line) => logs.push(line),
    defer: (work) => deferred.push(work),
    rpc: (fn, args) => {
      calls.push({ fn, args });
      if (fn === "api_gate" && answers.api_gate === undefined) {
        if (args.p_digest === null) {
          return Promise.resolve({ data: { ok: false, code: "missing-key" }, error: null });
        }
        if (args.p_digest !== digest) {
          return Promise.resolve({ data: { ok: false, code: "invalid-key" }, error: null });
        }
        return Promise.resolve({
          data: { ok: true, key_id: "k-1", digest, limit: 120, remaining: 119, reset: 42 },
          error: null,
        });
      }
      const answer = answers[fn];
      return Promise.resolve(answer === undefined ? { data: null, error: null } : answer(args));
    },
    ...overrides,
  };
  return { handler: createApiHandler(deps), calls, logs, deferred, digest };
}

function get(path: string, headers: Record<string, string> = { Authorization: `Bearer ${KEY}` }): Request {
  return new Request(`${BASE}${path}`, { headers });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("a preflight is answered without a key or a database", async () => {
  const { handler, calls } = await setup();
  const response = await handler(new Request(`${BASE}/v1/cleanings`, { method: "OPTIONS" }));
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertMatch(response.headers.get("Access-Control-Allow-Headers") ?? "", /idempotency-key/);
  assertEquals(calls.length, 0);
});

Deno.test("a key in the URL is refused before anything else", async () => {
  const { handler, calls } = await setup();
  const response = await handler(get(`/v1/me?api_key=${KEY}`, {}));
  assertEquals(response.status, 400);
  assertEquals(response.headers.get("Content-Type"), "application/problem+json");
  const body = await response.json();
  assertEquals(body.code, "key-in-url");
  assertEquals(body.type, "urn:woom:problem:key-in-url");
  assert(!JSON.stringify(body).includes(KEY));
  assertEquals(calls.length, 0);
});

Deno.test("without a pepper every request is a 500 with the reason in the log", async () => {
  const { handler, logs } = await setup({}, { pepper: null });
  const response = await handler(get("/v1/me"));
  assertEquals(response.status, 500);
  assertMatch(logs.join("\n"), /API_KEY_PEPPER/);
});

Deno.test("no key: 401 missing-key with WWW-Authenticate, the gate asked with no digest", async () => {
  const { handler, calls } = await setup();
  const response = await handler(get("/v1/me", {}));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).code, "missing-key");
  assertMatch(response.headers.get("WWW-Authenticate") ?? "", /Bearer/);
  assertEquals(calls[0].args.p_digest, null);
});

Deno.test("the key itself never reaches the database or the log, only its HMAC", async () => {
  const { handler, calls, logs, digest } = await setup({ api_v1_get_me: () => ({ data: { key: {}, company: {} }, error: null }) });
  await handler(get("/v1/me", { Authorization: `Bearer ${KEY}`, "cf-connecting-ip": "203.0.113.7" }));
  assertEquals(calls[0].args.p_digest, digest);
  assertEquals(calls[0].args.p_ip_hash, await hmacHex(PEPPER, "ip:203.0.113.7"));
  const everything = JSON.stringify(calls) + logs.join("\n");
  assert(!everything.includes(KEY));
  assert(!everything.includes("203.0.113.7"));
});

Deno.test("a gate that hands back another digest is not trusted", async () => {
  const { handler } = await setup({
    api_gate: () => ({ data: { ok: true, key_id: "k-1", digest: "0".repeat(64), limit: 120, remaining: 1, reset: 1 }, error: null }),
  });
  assertEquals((await handler(get("/v1/me"))).status, 401);
});

Deno.test("the gate's refusals: invalid, expired, revoked, suspended", async () => {
  for (const code of ["invalid-key", "key-expired", "key-revoked", "key-suspended"]) {
    const { handler } = await setup({ api_gate: () => ({ data: { ok: false, code }, error: null }) });
    const response = await handler(get("/v1/me"));
    assertEquals(response.status, 401, code);
    assertEquals((await response.json()).code, code);
  }
});

Deno.test("rate limited: 429 with Retry-After and the window", async () => {
  const { handler } = await setup({
    api_gate: () => ({ data: { ok: false, code: "rate-limited", retry_after: 17, limit: 120, remaining: 0, reset: 17 }, error: null }),
  });
  const response = await handler(get("/v1/me"));
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "17");
  assertEquals(response.headers.get("X-RateLimit-Remaining"), "0");
});

Deno.test("every answer carries the rate window and a request id", async () => {
  const { handler } = await setup({ api_v1_get_settings: () => ({ data: { company_id: UUID }, error: null }) });
  const response = await handler(get("/v1/settings"));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("RateLimit-Policy"), '"default";q=120;w=60');
  assertEquals(response.headers.get("RateLimit"), '"default";r=119;t=42');
  assertEquals(response.headers.get("X-RateLimit-Limit"), "120");
  assertEquals(response.headers.get("X-Request-Id"), "11111111-1111-4111-8111-111111111111");
});

Deno.test("both ways of reaching the function find the route", async () => {
  const { handler } = await setup({ api_v1_get_settings: () => ({ data: {}, error: null }) });
  assertEquals((await handler(new Request("http://x/functions/v1/api/v1/settings", { headers: { Authorization: `Bearer ${KEY}` } }))).status, 200);
  assertEquals((await handler(new Request("http://x/v1/settings", { headers: { Authorization: `Bearer ${KEY}` } }))).status, 200);
});

Deno.test("unknown path 404, wrong method 405 with Allow", async () => {
  const { handler } = await setup();
  assertEquals((await handler(get("/v1/nothing"))).status, 404);
  const response = await handler(new Request(`${BASE}/v1/cleanings`, { method: "DELETE", headers: { Authorization: `Bearer ${KEY}` } }));
  assertEquals(response.status, 405);
  assertEquals(response.headers.get("Allow"), "GET");
});

Deno.test("an unknown or malformed parameter is a 400 naming it", async () => {
  const { handler, calls } = await setup();
  const response = await handler(get("/v1/cleanings?date_frm=2026-11-01&status=nonsense&property_id=abc"));
  assertEquals(response.status, 400);
  const names = (await response.json()).errors.map((e: { name: string }) => e.name).sort();
  assertEquals(names, ["date_frm", "property_id", "status"]);
  assertEquals(calls.filter((c) => c.fn === "api_v1_list_cleanings").length, 0);
});

Deno.test("a date range over 366 days, or backwards, is refused", async () => {
  const { handler } = await setup();
  assertEquals((await handler(get("/v1/cleanings?date_from=2026-01-01&date_to=2027-03-01"))).status, 400);
  assertEquals((await handler(get("/v1/cleanings?date_from=2026-02-01&date_to=2026-01-01"))).status, 400);
});

Deno.test("filters reach the function under their argument names", async () => {
  const { handler, calls } = await setup({ api_v1_list_cleanings: () => ({ data: [], error: null }) });
  await handler(get(`/v1/cleanings?date_from=2026-11-01&date_to=2026-11-07&status=assigned,accepted&assignee_id=${UUID}&limit=10`));
  const args = calls.find((c) => c.fn === "api_v1_list_cleanings")?.args ?? {};
  assertEquals(args.p_date_from, "2026-11-01");
  assertEquals(args.p_status, ["assigned", "accepted"]);
  assertEquals(args.p_assignee_id, UUID);
  assertEquals(args.p_limit, 10);
});

Deno.test("a page one longer than the limit gives a cursor that leads on", async () => {
  const rows = [
    { id: "a1000000-0000-4000-8000-000000000001", scheduled_date: "2026-11-01" },
    { id: "a1000000-0000-4000-8000-000000000002", scheduled_date: "2026-11-02" },
    { id: "a1000000-0000-4000-8000-000000000003", scheduled_date: "2026-11-03" },
  ];
  const { handler, calls } = await setup({ api_v1_list_cleanings: () => ({ data: rows, error: null }) });
  const first = await (await handler(get("/v1/cleanings?type=cleaning&limit=2"))).json();
  assertEquals(first.data.length, 2);
  assert(typeof first.next_cursor === "string");

  await handler(get(`/v1/cleanings?type=cleaning&limit=2&cursor=${first.next_cursor}`));
  const args = calls.filter((c) => c.fn === "api_v1_list_cleanings")[1].args;
  assertEquals(args.p_after_date, "2026-11-02");
  assertEquals(args.p_after_id, "a1000000-0000-4000-8000-000000000002");

  const other = await handler(get(`/v1/cleanings?type=inspection&limit=2&cursor=${first.next_cursor}`));
  assertEquals(other.status, 400);
  assertEquals((await other.json()).code, "invalid-cursor");
  assertEquals((await handler(get("/v1/cleanings?cursor=garbage"))).status, 400);
});

Deno.test("the last page has no cursor, and fields for the handler stay inside", async () => {
  const { handler } = await setup({
    api_v1_list_tasks: () => ({ data: [{ id: UUID, title: "T", _sort: "2026-10-28T09:15:00.123456+00:00" }], error: null }),
  });
  const body = await (await handler(get("/v1/tasks"))).json();
  assertEquals(body.next_cursor, null);
  assertEquals(body.data, [{ id: UUID, title: "T" }]);
});

Deno.test("a missing scope is a 403 that names the scope", async () => {
  const { handler } = await setup({
    api_v1_list_cleanings: () => ({
      data: null,
      error: { code: "42501", message: "API key lacks scope cleanings:read", hint: "api:insufficient-scope", details: '{"required_scope":"cleanings:read"}' },
    }),
  });
  const response = await handler(get("/v1/cleanings"));
  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.code, "insufficient-scope");
  assertEquals(body.required_scope, "cleanings:read");
});

Deno.test("the panel's refusals travel as their key: 422 rejected, 409 conflict", async () => {
  const { handler } = await setup({
    api_v1_assign_cleaning: () => ({
      data: null,
      error: { code: "23514", message: "A cleaning is not handed to a technician", hint: "serverErrors.cleaningNotForTech", details: '{"type":"cleaning"}' },
    }),
    api_v1_assign_task: () => ({
      data: null,
      error: { code: "23514", message: "Problem is resolved", hint: "serverErrors.problemNotOpen", details: null },
    }),
  });
  const rejected = await handler(post(`/v1/cleanings/${UUID}/assign`, { assignee_id: UUID }));
  assertEquals(rejected.status, 422);
  const body = await rejected.json();
  assertEquals([body.code, body.reason, body.params.type], ["rejected", "serverErrors.cleaningNotForTech", "cleaning"]);
  assert(!JSON.stringify(body).includes("technician"));

  const conflict = await handler(post(`/v1/tasks/${UUID}/assign`, { assignee_id: UUID }));
  assertEquals(conflict.status, 409);
});

Deno.test("an error that is not ours is a bare 500, its SQLSTATE in the log", async () => {
  const { handler, logs } = await setup({
    api_v1_get_settings: () => ({ data: null, error: { code: "XX000", message: "relation secret_table does not exist" } }),
  });
  const response = await handler(get("/v1/settings"));
  assertEquals(response.status, 500);
  const text = await response.text();
  assert(!text.includes("secret_table"));
  assertMatch(logs.join("\n"), /XX000/);
});

Deno.test("a write needs JSON, a known body and an Idempotency-Key", async () => {
  const { handler, calls } = await setup();
  assertEquals((await handler(post("/v1/tasks", { title: "T" }, { "Content-Type": "text/plain" }))).status, 415);
  assertEquals((await handler(post("/v1/tasks", "{not json"))).status, 400);
  const unknown = await handler(post("/v1/tasks", { title: "T", colour: "red" }));
  assertEquals((await unknown.json()).errors[0].name, "colour");
  const noKey = new Request(`${BASE}/v1/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: '{"title":"T"}',
  });
  assertEquals((await (await handler(noKey)).json()).code, "idempotency-key-required");
  assertEquals((await handler(post("/v1/tasks", { title: "T" }, { "Idempotency-Key": "has space" }))).status, 400);
  assertEquals((await handler(post("/v1/tasks", { title: "x".repeat(17_000) }))).status, 413);
  assertEquals(calls.filter((c) => c.fn === "api_v1_create_task").length, 0);
});

Deno.test("a write answers the database's status and marks a replay", async () => {
  const task = { id: UUID, title: "T" };
  const { handler, calls } = await setup({
    api_v1_create_task: (args) => ({
      data: { status: 201, body: task, replayed: args.p_idempotency_key === "again" },
      error: null,
    }),
  });
  const created = await handler(post("/v1/tasks", { title: "T", priority: "high", property_id: 123 }));
  assertEquals(created.status, 201);
  assertEquals((await created.json()).data, task);
  assertEquals(created.headers.get("Idempotent-Replayed"), null);
  const args = calls.find((c) => c.fn === "api_v1_create_task")?.args ?? {};
  assertEquals([args.p_title, args.p_priority, args.p_property_id, args.p_idempotency_key], ["T", "high", 123, "idem-1"]);
  assertMatch(String(args.p_request_hash), /^[0-9a-f]{64}$/);

  const replay = await handler(post("/v1/tasks", { title: "T", priority: "high", property_id: 123 }, { "Idempotency-Key": "again" }));
  assertEquals(replay.headers.get("Idempotent-Replayed"), "true");
});

Deno.test("the same body in another key order hashes the same", async () => {
  const { handler, calls } = await setup({ api_v1_create_task: () => ({ data: { status: 201, body: { id: UUID } }, error: null }) });
  await handler(post("/v1/tasks", '{"title":"T","priority":"low"}'));
  await handler(post("/v1/tasks", '{"priority":"low","title":"T"}'));
  const hashes = calls.filter((c) => c.fn === "api_v1_create_task").map((c) => c.args.p_request_hash);
  assertEquals(hashes[0], hashes[1]);
});

Deno.test("null takes a cleaning's executor off; the field must still be sent", async () => {
  const { handler, calls } = await setup({ api_v1_assign_cleaning: () => ({ data: { status: 200, body: { id: UUID } }, error: null }) });
  assertEquals((await handler(post(`/v1/cleanings/${UUID}/assign`, { assignee_id: null }))).status, 200);
  assertEquals(calls.find((c) => c.fn === "api_v1_assign_cleaning")?.args.p_assignee_id, null);
  assertEquals((await handler(post(`/v1/cleanings/${UUID}/assign`, {}))).status, 400);
});

Deno.test("the request log: key, operation, status, object — after the answer", async () => {
  const { handler, deferred, calls } = await setup({ api_v1_create_task: () => ({ data: { status: 201, body: { id: UUID } }, error: null }) });
  await handler(post("/v1/tasks", { title: "T" }));
  await Promise.all(deferred);
  const log = calls.find((c) => c.fn === "api_log_request")?.args ?? {};
  assertEquals([log.p_key_id, log.p_operation, log.p_method, log.p_status, log.p_object_id], ["k-1", "createTask", "POST", 201, UUID]);
});

Deno.test("a request that never had a key is not logged", async () => {
  const { handler, deferred, calls } = await setup();
  await handler(get("/v1/me", {}));
  await Promise.all(deferred);
  assertEquals(calls.filter((c) => c.fn === "api_log_request").length, 0);
});

Deno.test("only the edge's own header names the address; a forged one is ignored", async () => {
  const { handler, calls } = await setup({ api_v1_get_me: () => ({ data: {}, error: null }) });
  await handler(get("/v1/me", { Authorization: `Bearer ${KEY}`, "x-forwarded-for": "198.51.100.9", "x-real-ip": "198.51.100.9" }));
  assertEquals(calls[0].args.p_ip_hash, null);
});

Deno.test("an IPv6 address counts by its /64", async () => {
  const { handler, calls } = await setup({ api_v1_get_me: () => ({ data: {}, error: null }) });
  await handler(get("/v1/me", { Authorization: `Bearer ${KEY}`, "cf-connecting-ip": "2a02:8308:a084:4b00:1111:2222:3333:4444" }));
  await handler(get("/v1/me", { Authorization: `Bearer ${KEY}`, "cf-connecting-ip": "2a02:8308:a084:4b00:9999:8888:7777:6666" }));
  const gates = calls.filter((c) => c.fn === "api_gate");
  assertEquals(gates[0].args.p_ip_hash, await hmacHex(PEPPER, "ip:2a02:8308:a084:4b00"));
  assertEquals(gates[0].args.p_ip_hash, gates[1].args.p_ip_hash);
});

Deno.test("no credentials: Bearer realm only, no error code (RFC 6750 §3.1)", async () => {
  const { handler } = await setup();
  assertEquals((await handler(get("/v1/me", {}))).headers.get("WWW-Authenticate"), 'Bearer realm="woom"');
});

Deno.test("a NUL in text, an id past 15 digits, a path value given again in the query: 400", async () => {
  const { handler } = await setup();
  assertEquals((await handler(post("/v1/tasks", { title: "a b" }))).status, 400);
  assertEquals((await handler(get("/v1/properties/1234567890123456"))).status, 400);
  assertEquals((await handler(get("/v1/properties/5?id=6"))).status, 400);
});

Deno.test("a body that says it is too large is refused before it is read", async () => {
  const { handler } = await setup();
  const request = new Request(`${BASE}/v1/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "Idempotency-Key": "k", "Content-Length": "999999" },
    body: "{}",
  });
  assertEquals((await handler(request)).status, 413);
});

Deno.test("a value Postgres could not take (any class 22 state) is a 400, not a 500", async () => {
  const { handler } = await setup({
    api_v1_get_settings: () => ({ data: null, error: { code: "22P05", message: "unsupported Unicode escape sequence" } }),
  });
  assertEquals((await handler(get("/v1/settings"))).status, 400);
});
