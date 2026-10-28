// The public API on the LOCAL stand, over real HTTP, with nothing committed
// (docs/api-v1.md §14).
//
// The handler is supabase/functions/api/handler.ts itself. The database is one
// connection to the stand's Postgres inside a transaction that is never
// committed: the migration (when the stand lacks it), a demo admin and keys
// are made inside it, every call runs in a savepoint, and Ctrl+C, the time
// limit or a crash rolls everything back. Other sessions on the stand wait on
// the rows and tables it touches while it runs — keep it short.
//
//   npx deno run --node-modules-dir=none --no-lock --allow-net=127.0.0.1 \
//     --allow-read --allow-write --allow-env --allow-sys scripts/api-stand-server.ts \
//     serve --keys-out <file> [--minutes 20]
//     — listens on http://127.0.0.1:8787; the keys go to <file>, never to the screen
//   … scripts/api-stand-server.ts contract
//     — the same, then every operation and its errors over HTTP, each answer
//       checked against openapi.v1.json; exits 0 when all fit
//
// The pepper is made fresh for each run and dies with it.

import postgres from "npm:postgres@3.4.5";

import { checkSchema } from "../packages/shared/src/api/schema-check.ts";
import { generateApiKey, hmacHex } from "../supabase/functions/_shared/api-key.ts";
import { createApiHandler, type RpcResult } from "../supabase/functions/api/handler.ts";

type Json = Record<string, unknown>;

const MIGRATION = "supabase/migrations/20261028100000_public_api_v1.sql";
const SPEC = "packages/shared/src/api/openapi.v1.json";
const PORT = 8787;
const DEMO_ADMIN = "a2899999-0000-4000-8000-000000000001";
const OTHER_HOST = "a2899999-0000-4000-8000-00000000000b";
const OTHER_ADMIN = "a2899999-0000-4000-8000-000000000002";

function argOf(name: string): string | null {
  const i = Deno.args.indexOf(name);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : null;
}

const mode = Deno.args[0];
if (mode !== "serve" && mode !== "contract") {
  console.error("Usage: scripts/api-stand-server.ts serve --keys-out <file> [--minutes 20] | contract");
  Deno.exit(2);
}

// The local stack's default credentials (supabase/config.toml, db.port); never a cloud address.
const sql = postgres("postgres://postgres:postgres@127.0.0.1:54322/postgres", { max: 1, onnotice: () => {} });
const db = await sql.reserve();
await db.unsafe("begin");

let closed = false;
async function rollbackAndExit(code: number): Promise<never> {
  if (!closed) {
    closed = true;
    try {
      await db.unsafe("rollback");
    } finally {
      db.release();
      await sql.end({ timeout: 5 });
    }
    console.log("rolled back: the stand is as it was");
  }
  Deno.exit(code);
}

// One statement at a time on the one connection.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

const argTypes = new Map<string, Map<string, string>>();
async function typesOf(fn: string): Promise<Map<string, string>> {
  const known = argTypes.get(fn);
  if (known !== undefined) {
    return known;
  }
  const rows = await db.unsafe(
    `select unnest(p.proargnames) as name, unnest(p.proargtypes::oid[]::regtype[])::text as type
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
    [fn],
  );
  const types = new Map(rows.map((r) => [String(r.name), String(r.type)]));
  argTypes.set(fn, types);
  return types;
}

/** PostgREST's call, by named arguments, in a savepoint; its error in supabase-js's shape. */
function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  return serial(async () => {
    if (!/^[a-z_0-9]+$/.test(fn)) {
      return { data: null, error: { code: "42883", message: "no such function" } };
    }
    const types = await typesOf(fn);
    const names = Object.keys(args).filter((name) => types.has(name));
    // Every value travels as JSON text and is read back by the declared type,
    // so postgres.js never guesses a parameter's type.
    const values: unknown[] = [];
    const parts = names.map((name) => {
      const type = types.get(name) as string;
      values.push(JSON.stringify(args[name] ?? null));
      const n = values.length;
      return type.endsWith("[]")
        ? `${name} => (case when jsonb_typeof($${n}::text::jsonb) = 'array' then coalesce((select array_agg(x)::${type} from jsonb_array_elements_text($${n}::text::jsonb) x), '{}') end)`
        : `${name} => ($${n}::text::jsonb #>> '{}')::${type}`;
    });
    await db.unsafe("savepoint api_call");
    try {
      const rows = await db.unsafe(`select public.${fn}(${parts.join(", ")})::text as r`, values as never[]);
      await db.unsafe("release savepoint api_call");
      const text = rows[0]?.r as string | null;
      return { data: text === null || text === undefined || text === "" ? null : JSON.parse(text), error: null };
    } catch (error) {
      await db.unsafe("rollback to savepoint api_call");
      const e = error as { code?: string; message?: string; detail?: string; hint?: string };
      if (Deno.env.get("API_STAND_DEBUG") === "1") {
        console.error(`${fn}(${parts.join(", ")}): ${e.message}`);
      }
      return { data: null, error: { code: e.code ?? null, message: e.message ?? null, details: e.detail ?? null, hint: e.hint ?? null } };
    } finally {
      // PostgREST runs each call in its own transaction; here the claims a write
      // set must not outlive it.
      await db.unsafe(
        "select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)",
      );
    }
  });
}

// ---------- the stand: migration, demo admin, keys ----------

const hasSchema = (await db.unsafe("select to_regclass('public.api_keys') is not null as ok"))[0].ok === true;
if (!hasSchema) {
  await db.unsafe(await Deno.readTextFile(MIGRATION));
}
const host = (await db.unsafe("select id from public.hosts order by created_at limit 1"))[0]?.id as string | undefined;
if (host === undefined) {
  console.error("The stand has no company");
  await rollbackAndExit(1);
}
await db.unsafe(
  `insert into public.hosts (id, name) values ($1, 'Other company (stand)');
   insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at,
                           raw_user_meta_data, raw_app_meta_data)
   values ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           'api.stand.admin@test.local', 'x', now(), now(), '{"full_name":"API stand admin"}', '{"role":"admin"}'),
          ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           'api.stand.other@test.local', 'x', now(), now(), '{"full_name":"Other admin"}', '{"role":"admin"}');`.replace(
    /\$1/g,
    `'${OTHER_HOST}'`,
  ).replace(/\$2/g, `'${DEMO_ADMIN}'`).replace(/\$3/g, `'${OTHER_ADMIN}'`),
);
await db.unsafe(`update public.profiles set host_id = $1 where id = $2`, [host, DEMO_ADMIN]);
await db.unsafe(`update public.profiles set host_id = $1 where id = $2`, [OTHER_HOST, OTHER_ADMIN]);
const firstProperty = (await db.unsafe(
  "select id from public.properties where host_id = $1 and parent_id is null order by id limit 1",
  [host],
))[0]?.id as string | undefined;

const pepperBytes = new Uint8Array(32);
crypto.getRandomValues(pepperBytes);
const pepper = Array.from(pepperBytes, (b) => b.toString(16).padStart(2, "0")).join("");

interface KeySpec {
  readonly actor: string;
  readonly name: string;
  readonly preset: string;
  readonly scopes: string[];
  readonly properties: number[] | null;
}

const KEY_SPECS: Record<string, KeySpec> = {
  read_only: { actor: DEMO_ADMIN, name: "Stand read only", preset: "read_only", scopes: [], properties: null },
  operator: { actor: DEMO_ADMIN, name: "Stand operator", preset: "operator", scopes: [], properties: null },
  full: { actor: DEMO_ADMIN, name: "Stand full", preset: "full", scopes: [], properties: null },
  custom: { actor: DEMO_ADMIN, name: "Stand custom", preset: "custom", scopes: ["cleanings:read"], properties: null },
  house: {
    actor: DEMO_ADMIN,
    name: "Stand one property",
    preset: "read_only",
    scopes: [],
    properties: firstProperty === undefined ? null : [Number(firstProperty)],
  },
  other: { actor: OTHER_ADMIN, name: "Stand other company", preset: "full", scopes: [], properties: null },
};

const keys: Record<string, string> = {};
for (const [label, spec] of Object.entries(KEY_SPECS)) {
  const key = generateApiKey();
  const { error } = await rpc("create_api_key", {
    p_actor: spec.actor,
    p_name: spec.name,
    p_prefix: key.slice(0, 12),
    p_digest: await hmacHex(pepper, key),
    p_preset: spec.preset,
    p_scopes: spec.scopes,
    p_property_ids: spec.properties,
    p_expires_at: null,
    p_confirmation: spec.name,
  });
  if (error !== null) {
    console.error(`could not make the ${label} key: ${error.hint ?? error.code} ${error.message ?? ""}`);
    await rollbackAndExit(1);
  }
  keys[label] = key;
}

const handler = createApiHandler({
  pepper,
  rpc,
  logError: (line) => console.error(line),
  defer: (work) => void work.catch(() => undefined),
});

const deadline = Number(argOf("--minutes") ?? (mode === "serve" ? 20 : 5));
const timer = setTimeout(() => {
  console.log(`time limit of ${deadline} minutes reached`);
  void rollbackAndExit(0);
}, deadline * 60_000);
Deno.addSignalListener("SIGINT", () => void rollbackAndExit(0));

const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen: () => {} }, handler);
console.log(`API on http://127.0.0.1:${PORT}/v1 — company of the stand, nothing committed`);

if (mode === "serve") {
  const out = argOf("--keys-out");
  if (out === null) {
    console.error("serve needs --keys-out <file>: the keys are not printed");
    await rollbackAndExit(2);
  }
  await Deno.writeTextFile(out as string, JSON.stringify(keys, null, 2));
  console.log(`keys written to ${out} (read_only, operator, full, custom, house, other); Ctrl+C rolls back`);
  await server.finished;
} else {
  const failures = await contract(keys);
  clearTimeout(timer);
  await server.shutdown();
  await rollbackAndExit(failures === 0 ? 0 : 1);
}

// ---------- the contract over HTTP ----------

async function contract(k: Record<string, string>): Promise<number> {
  const spec = JSON.parse(await Deno.readTextFile(SPEC)) as Json;
  const base = `http://127.0.0.1:${PORT}`;
  let checked = 0;
  let failures = 0;

  function resolve(node: Json): Json {
    let current = node;
    while (typeof current.$ref === "string") {
      let target: unknown = spec;
      for (const part of (current.$ref as string).slice(2).split("/")) target = (target as Json)[part];
      current = target as Json;
    }
    return current;
  }

  function schemaFor(path: string, method: string, status: number, problem: boolean): Json | null {
    const op = ((spec.paths as Json)[path] as Json)[method.toLowerCase()] as Json;
    const response = (op.responses as Json)[String(status)] as Json | undefined;
    if (response === undefined) return null;
    const content = resolve(response).content as Json;
    const media = content[problem ? "application/problem+json" : "application/json"] as Json | undefined;
    return (media?.schema as Json | undefined) ?? null;
  }

  async function call(
    label: string,
    template: string,
    url: string,
    init: RequestInit,
    expected: number,
    expectedCode?: string,
  ): Promise<Json | null> {
    const response = await fetch(`${base}${url}`, init);
    const body = await response.json() as Json;
    const problem = response.status >= 400;
    const issues: string[] = [];
    if (response.status !== expected) issues.push(`status ${response.status}, wanted ${expected}`);
    if (expectedCode !== undefined && body.code !== expectedCode) issues.push(`code ${String(body.code)}, wanted ${expectedCode}`);
    const schema = schemaFor(template, (init.method ?? "GET"), response.status, problem);
    if (schema === null) {
      issues.push(`the spec lists no ${response.status} for ${init.method ?? "GET"} ${template}`);
    } else {
      issues.push(...checkSchema(schema, body, spec).map((i) => `${i.path} ${i.message}`));
    }
    if (problem && response.headers.get("Content-Type") !== "application/problem+json") issues.push("not problem+json");
    if (response.headers.get("X-RateLimit-Limit") === null && response.status !== 401) issues.push("no rate headers");
    checked += 1;
    if (issues.length > 0) {
      failures += 1;
      console.log(`FAIL ${label}: ${issues.slice(0, 5).join("; ")}`);
    } else {
      console.log(`ok   ${label} (${response.status}${expectedCode ? ` ${expectedCode}` : ""})`);
    }
    return body;
  }

  const auth = (key: string) => ({ headers: { Authorization: `Bearer ${key}` } });
  const write = (key: string, body: unknown, idem: string): RequestInit => ({
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idem },
    body: JSON.stringify(body),
  });

  await call("me", "/v1/me", "/v1/me", auth(k.read_only), 200);
  const props = await call("properties", "/v1/properties", "/v1/properties?limit=2", auth(k.full), 200);
  if (typeof props?.next_cursor === "string") {
    await call("properties, page 2", "/v1/properties", `/v1/properties?limit=2&cursor=${props.next_cursor}`, auth(k.full), 200);
  }
  const propertyId = ((props?.data ?? []) as Json[])[0]?.id;
  if (propertyId !== undefined) {
    await call("a property", "/v1/properties/{id}", `/v1/properties/${propertyId}`, auth(k.full), 200);
  }
  const cleanings = await call("cleanings", "/v1/cleanings", "/v1/cleanings?limit=50&type=cleaning", auth(k.full), 200);
  const cleaningRows = (cleanings?.data ?? []) as Json[];
  if (cleaningRows[0] !== undefined) {
    await call("a cleaning", "/v1/cleanings/{id}", `/v1/cleanings/${cleaningRows[0].id}`, auth(k.read_only), 200);
    await call("a cleaning's media", "/v1/cleanings/{id}/media", `/v1/cleanings/${cleaningRows[0].id}/media`, auth(k.read_only), 200);
  }
  const tasks = await call("tasks", "/v1/tasks", "/v1/tasks?limit=2&include_archived=true", auth(k.read_only), 200);
  if (typeof tasks?.next_cursor === "string") {
    await call("tasks, page 2", "/v1/tasks", `/v1/tasks?limit=2&include_archived=true&cursor=${tasks.next_cursor}`, auth(k.read_only), 200);
  }
  const staff = await call("staff", "/v1/staff", "/v1/staff?limit=200", auth(k.full), 200);
  const people = (staff?.data ?? []) as Json[];
  if (people[0] !== undefined) {
    await call("a person", "/v1/staff/{id}", `/v1/staff/${people[0].id}`, auth(k.read_only), 200);
  }
  const bookings = await call("bookings", "/v1/bookings", "/v1/bookings?limit=2", auth(k.read_only), 200);
  const bookingId = ((bookings?.data ?? []) as Json[])[0]?.id;
  if (bookingId !== undefined) {
    await call("a booking", "/v1/bookings/{id}", `/v1/bookings/${bookingId}`, auth(k.read_only), 200);
  }
  await call("settings", "/v1/settings", "/v1/settings", auth(k.read_only), 200);

  // The errors an integration meets first.
  await call("no key", "/v1/me", "/v1/me", {}, 401, "missing-key");
  await call("a made-up key", "/v1/me", "/v1/me", auth(`woom_${"x".repeat(43)}`), 401, "invalid-key");
  await call("read only writes", "/v1/tasks", "/v1/tasks", write(k.read_only, { title: "x" }, "c-1"), 403, "insufficient-scope");
  await call("custom reads properties", "/v1/properties", "/v1/properties", auth(k.custom), 403, "insufficient-scope");
  await call("an unknown filter", "/v1/cleanings", "/v1/cleanings?colour=red", auth(k.full), 400, "invalid-request");
  await call("a bad cursor", "/v1/cleanings", "/v1/cleanings?cursor=abc", auth(k.full), 400, "invalid-cursor");
  await call("another company's property", "/v1/properties/{id}", `/v1/properties/${propertyId ?? 1}`, auth(k.other), 404, "not-found");
  const others = await call("the other company's list", "/v1/properties", "/v1/properties", auth(k.other), 200);
  if (((others?.data ?? []) as Json[]).length !== 0) {
    failures += 1;
    console.log("FAIL the other company sees properties of this one");
  }
  const house = await call("the one-property key's list", "/v1/properties", "/v1/properties?limit=200", auth(k.house), 200);
  const houseIds = new Set(((house?.data ?? []) as Json[]).map((p) => p.id));
  const outside = cleaningRows.find((c) => !houseIds.has(c.property_id));
  if (outside !== undefined) {
    await call("a cleaning outside the key's property", "/v1/cleanings/{id}", `/v1/cleanings/${outside.id}`, auth(k.house), 404, "not-found");
  }

  // Writes, as the stand's demo admin.
  const tech = people.find((p) => p.role === "tech" && p.is_active === true);
  const cleaner = people.find((p) => p.role === "cleaner" && p.is_active === true);
  const body = { title: "API stand: dripping tap", priority: "high", property_id: propertyId ?? null };
  const created = await call("create a task", "/v1/tasks", "/v1/tasks", write(k.operator, body, "stand-1"), 201);
  await call("the same request again", "/v1/tasks", "/v1/tasks", write(k.operator, body, "stand-1"), 201);
  await call("the same key, another body", "/v1/tasks", "/v1/tasks", write(k.operator, { ...body, title: "other" }, "stand-1"), 422, "idempotency-key-reused");
  const taskId = (created?.data as Json | undefined)?.id;
  if (taskId !== undefined && tech !== undefined) {
    await call("assign the task", "/v1/tasks/{id}/assign", `/v1/tasks/${taskId}/assign`, write(k.operator, { assignee_id: tech.id }, "stand-2"), 200);
  }
  const openList = await call("open cleanings", "/v1/cleanings", "/v1/cleanings?type=cleaning&status=unassigned,assigned&limit=5", auth(k.full), 200);
  const open = ((openList?.data ?? []) as Json[])[0];
  if (open !== undefined && cleaner !== undefined) {
    await call("assign a cleaning", "/v1/cleanings/{id}/assign", `/v1/cleanings/${open.id}/assign`, write(k.operator, { assignee_id: cleaner.id }, "stand-3"), 200);
    if (tech !== undefined) {
      await call("a cleaning to a technician", "/v1/cleanings/{id}/assign", `/v1/cleanings/${open.id}/assign`, write(k.operator, { assignee_id: tech.id }, "stand-4"), 422, "rejected");
    }
  }

  console.log(`${checked - failures}/${checked} answers fit the spec`);
  return failures;
}
