/**
 * The spec and the implementation say the same thing (docs/api-v1.md §10).
 *
 * One to one: every operation of packages/shared/src/api/openapi.v1.json is a
 * route of routes.ts with the same method, path, scope, parameters and body,
 * and every route is in the spec. Then the handler's answers — success and
 * problem alike — are checked against the spec's schemas. A real database's
 * answers are checked the same way by scripts/api-stand-server.ts.
 */

import { assert, assertEquals } from "jsr:@std/assert@1";

import { checkSchema } from "../../../packages/shared/src/api/schema-check.ts";
import { hmacHex } from "../_shared/api-key.ts";
import { createApiHandler, type RpcResult } from "./handler.ts";
import { PROBLEMS } from "./problem.ts";
import { ROUTES } from "./routes.ts";

type Json = Record<string, unknown>;

const spec = JSON.parse(
  await Deno.readTextFile(new URL("../../../packages/shared/src/api/openapi.v1.json", import.meta.url)),
) as Json;

function resolve(node: Json): Json {
  let current = node;
  while (typeof current.$ref === "string") {
    let target: unknown = spec;
    for (const part of (current.$ref as string).slice(2).split("/")) {
      target = (target as Json)[part];
    }
    current = target as Json;
  }
  return current;
}

interface SpecOperation {
  readonly method: string;
  readonly path: string;
  readonly op: Json;
}

const OPERATIONS: SpecOperation[] = Object.entries(spec.paths as Record<string, Json>).flatMap(([path, item]) =>
  ["get", "post", "put", "patch", "delete"]
    .filter((method) => item[method] !== undefined)
    .map((method) => ({ method: method.toUpperCase(), path, op: item[method] as Json }))
);

function specOf(operationId: string): SpecOperation {
  const found = OPERATIONS.find((o) => o.op.operationId === operationId);
  assert(found !== undefined, `${operationId} is not in the spec`);
  return found;
}

Deno.test("every route is an operation of the spec and every operation a route", () => {
  const routes = ROUTES.map((r) => `${r.method} ${r.path} ${r.operationId}`).sort();
  const operations = OPERATIONS.map((o) => `${o.method} ${o.path} ${o.op.operationId}`).sort();
  assertEquals(routes, operations);
});

Deno.test("each operation needs the scope its route checks, in x-woom-scope and in security", () => {
  for (const route of ROUTES) {
    const { op } = specOf(route.operationId);
    assertEquals(op["x-woom-scope"] ?? null, route.scope, route.operationId);
    const security = (op.security as Json[])[0].bearerAuth as string[];
    assertEquals(security, route.scope === null ? [] : [route.scope], route.operationId);
  }
});

Deno.test("query and path parameters are the route's, with the same required ones", () => {
  for (const route of ROUTES) {
    const params = ((specOf(route.operationId).op.parameters ?? []) as Json[]).map(resolve)
      .filter((p) => p.in === "query" || p.in === "path");
    const names = params.map((p) => String(p.name)).sort();
    const expected = [
      ...route.params.map((p) => p.name),
      ...(route.cursor === undefined ? [] : ["cursor", "limit"]),
    ].sort();
    assertEquals(names, expected, route.operationId);
    const required = params.filter((p) => p.required === true).map((p) => String(p.name)).sort();
    assertEquals(required, route.params.filter((p) => p.required).map((p) => p.name).sort(), route.operationId);
  }
});

Deno.test("a write's body fields and required ones are the route's, and it asks for Idempotency-Key", () => {
  for (const route of ROUTES.filter((r) => r.kind === "write")) {
    const { op } = specOf(route.operationId);
    const content = (op.requestBody as Json).content as Record<string, Json>;
    const schema = resolve(content["application/json"].schema as Json);
    assertEquals(Object.keys(schema.properties as Json).sort(), (route.body ?? []).map((b) => b.name).sort(), route.operationId);
    assertEquals(
      ((schema.required ?? []) as string[]).slice().sort(),
      (route.body ?? []).filter((b) => b.required).map((b) => b.name).sort(),
      route.operationId,
    );
    const headers = ((op.parameters ?? []) as Json[]).map(resolve).filter((p) => p.in === "header");
    assert(headers.some((h) => h.name === "Idempotency-Key" && h.required === true), route.operationId);
  }
});

Deno.test("the spec lists every problem code the handler can answer, at its status", () => {
  const problem = resolve({ $ref: "#/components/schemas/Problem" });
  const codes = ((problem.properties as Json).code as Json).enum as string[];
  assertEquals(codes.slice().sort(), Object.keys(PROBLEMS).sort());
});

Deno.test("each operation documents its success and the errors every request can meet", () => {
  for (const route of ROUTES) {
    const responses = specOf(route.operationId).op.responses as Json;
    const success = route.operationId === "createTask" ? "201" : "200";
    assert(responses[success] !== undefined, `${route.operationId} ${success}`);
    for (const status of ["401", "429", "500"]) {
      assert(responses[status] !== undefined, `${route.operationId} ${status}`);
    }
    if (route.scope !== null) {
      assert(responses["403"] !== undefined, `${route.operationId} 403`);
    }
    for (const [status, response] of Object.entries(responses)) {
      if (Number(status) >= 400) {
        const content = resolve(response as Json).content as Json;
        assert(content["application/problem+json"] !== undefined, `${route.operationId} ${status} is problem+json`);
      }
    }
  }
});

// ---------- the handler's answers against the spec's schemas ----------

const PEPPER = "p".repeat(32);
const KEY = `woom_${"B".repeat(43)}`;
const DIGEST = await hmacHex(PEPPER, KEY);
const UUID = "6f8d2c1e-5b7a-4e3f-9a10-2b4c6d8e0f12";
const TS = "2026-10-28T09:15:00Z";

const CLEANING = {
  id: UUID, type: "cleaning", status: "assigned", property_id: 123456, booking_id: 987654, task_id: null,
  scheduled_date: "2026-11-02", time_from: "11:00", time_to: "15:00", due_at: TS, priority: 1,
  assignee_id: UUID, title: null, text_masked: false, guests_count: 2, is_parallel: false, started_at: null, completed_at: null,
  completed_by: null, created_at: TS, updated_at: TS,
};
const TASK = {
  id: UUID, title: "Dripping tap", description: null, text_masked: false, priority: "high", status: "assigned", property_id: 123456,
  cleaning_id: null, reported_by: UUID, archived: false, cancel_reason: null,
  work: { cleaning_id: UUID, status: "assigned", assignee_id: UUID, scheduled_date: "2026-11-05", time_from: "09:00", time_to: null },
  created_at: TS, updated_at: TS, resolved_at: null, cancelled_at: null, archived_at: null,
};
const PROPERTY = {
  id: 123456, name: "Main House 4G", name_masked: true, parent_id: null, status: "active", city: "Prague",
  country_code: "CZ", timezone: "Europe/Prague", bedrooms: 2, bathrooms: 1.5, max_guests: 4,
  check_in_time: "15:00", check_out_time: "11:00", created_at: TS, updated_at: TS,
};
const STAFF = { id: UUID, role: "cleaner", is_active: true, created_at: TS, updated_at: TS };
const BOOKING = {
  id: 987654, property_id: 123456, room_ids: [123457], arrival_date: "2026-11-01", departure_date: "2026-11-04",
  check_in_time: null, check_out_time: "10:00", status: "new", channel: "airbnb", channel_id: 2018,
  guests_count: 2, is_block: false, created_at: TS, updated_at: TS,
};
const MEDIA = {
  id: UUID, kind: "video", source: "gallery", mime_type: "video/mp4", byte_size: 5000, width: null, height: null,
  duration_sec: 10.5, step_id: UUID, step_type: "video", status: "uploaded", created_by: UUID,
  device_taken_at: null, uploaded_at: TS, created_at: TS,
};
const ANSWERS: Record<string, unknown> = {
  api_v1_get_me: {
    key: { id: UUID, name: "Agent", prefix: "woom_BBBBBBB", preset: "read_only", scopes: ["cleanings:read"], property_ids: null, expires_at: null, created_at: TS },
    company: { id: UUID, name: "Company" },
  },
  api_v1_list_properties: [PROPERTY],
  api_v1_get_property: PROPERTY,
  api_v1_list_cleanings: [CLEANING],
  api_v1_get_cleaning: CLEANING,
  api_v1_assign_cleaning: { status: 200, body: CLEANING, replayed: false },
  api_v1_list_cleaning_media: [MEDIA],
  api_v1_list_tasks: [{ ...TASK, _sort: "2026-10-28T09:15:00.1+00:00" }],
  api_v1_get_task: TASK,
  api_v1_create_task: { status: 201, body: TASK, replayed: false },
  api_v1_assign_task: { status: 200, body: TASK, replayed: false },
  api_v1_list_task_media: [MEDIA],
  api_v1_list_staff: [STAFF],
  api_v1_get_staff_member: { ...STAFF, full_name: "Cleo" },
  api_v1_list_bookings: [BOOKING],
  api_v1_get_booking: BOOKING,
  api_v1_get_settings: {
    company_id: UUID, company_name: "Company", default_language: "en", video_max_sec: 180, video_max_mb: 140,
    video_bitrate_kbps: 2500, gallery_allowed: true, parallel_start_allowed: false, updated_at: TS,
  },
};
const BODIES: Record<string, unknown> = {
  assignCleaning: { assignee_id: UUID },
  createTask: { title: "Dripping tap", priority: "high", property_id: 123456 },
  assignTask: { assignee_id: UUID, scheduled_date: "2026-11-05", time_from: "09:00" },
};

const handler = createApiHandler({
  pepper: PEPPER,
  newRequestId: () => "22222222-2222-4222-8222-222222222222",
  logError: () => undefined,
  defer: () => undefined,
  rpc: (fn): Promise<RpcResult> => {
    if (fn === "api_gate") {
      return Promise.resolve({ data: { ok: true, key_id: "k", digest: DIGEST, limit: 120, remaining: 1, reset: 9 }, error: null });
    }
    return Promise.resolve({ data: ANSWERS[fn] ?? null, error: null });
  },
});

function requestFor(route: (typeof ROUTES)[number]): Request {
  const path = route.path.replace("{id}", route.params.some((p) => p.kind === "id" && p.name === "id") ? "123456" : UUID);
  const headers: Record<string, string> = { Authorization: `Bearer ${KEY}` };
  if (route.method === "POST") {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = "contract";
  }
  return new Request(`http://x/api${path}`, {
    method: route.method,
    headers,
    body: route.method === "POST" ? JSON.stringify(BODIES[route.operationId]) : undefined,
  });
}

Deno.test("every operation's answer fits its schema in the spec", async () => {
  for (const route of ROUTES) {
    const response = await handler(requestFor(route));
    const status = String(response.status);
    const documented = (specOf(route.operationId).op.responses as Json)[status];
    assert(documented !== undefined, `${route.operationId} answered ${status}, which the spec does not list`);
    const schema = (((resolve(documented as Json).content as Json)["application/json"] as Json).schema) as Json;
    const issues = checkSchema(schema, await response.json(), spec);
    assertEquals(issues, [], route.operationId);
  }
});

Deno.test("problems fit the Problem schema", async () => {
  const problem = resolve({ $ref: "#/components/schemas/Problem" });
  const answers = [
    await handler(new Request("http://x/api/v1/cleanings?nonsense=1", { headers: { Authorization: `Bearer ${KEY}` } })),
    await handler(new Request("http://x/api/v1/me?token=x")),
    await handler(new Request("http://x/api/v1/nowhere", { headers: { Authorization: `Bearer ${KEY}` } })),
  ];
  for (const answer of answers) {
    assertEquals(answer.headers.get("Content-Type"), "application/problem+json");
    assertEquals(checkSchema(problem, await answer.json(), spec), []);
  }
});

Deno.test("every exposed scope of the registry is checked by some route or marks a field", async () => {
  const registry = JSON.parse(
    await Deno.readTextFile(new URL("../../../packages/shared/src/api/registry.json", import.meta.url)),
  ) as { scopes: { id: string; status: string }[] };
  const fieldScopes = new Set<string>();
  for (const schema of Object.values(((spec.components as Json).schemas) as Record<string, Json>)) {
    for (const property of Object.values((schema.properties ?? {}) as Record<string, Json>)) {
      if (typeof property["x-woom-scope"] === "string") {
        fieldScopes.add(property["x-woom-scope"] as string);
      }
    }
  }
  const routeScopes = new Set(ROUTES.map((r) => r.scope));
  for (const scope of registry.scopes.filter((s) => s.status === "exposed")) {
    assert(routeScopes.has(scope.id) || fieldScopes.has(scope.id), `${scope.id} is exposed but nothing uses it`);
  }
});
