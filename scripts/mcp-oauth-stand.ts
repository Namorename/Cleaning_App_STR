// The MCP server's sign-in by OAuth, end to end on the LOCAL stand, nothing
// committed (docs/mcp-oauth.md §5).
//
// One process plays both sides:
//   * the server — the MCP handler, the Edge Function oauth's handler, the
//     panel's authorization-server metadata, and a stand consent step that does
//     what the panel's «Allow» does (oauth_authorize as an admin), over one
//     connection to the stand's Postgres inside a transaction that is rolled
//     back at the end, whatever happens;
//   * the client — the official MCP SDK with an OAuth provider: the 401, the
//     Protected Resource Metadata, the AS metadata, dynamic registration, PKCE,
//     the code, the tokens, the tools; then an access token run out and
//     refreshed, the REST API refusing the token, and a revoked connection.
//
// The stand needs 20261109120000 (npx supabase migration up --local).
//
//   npx deno run --node-modules-dir=none --no-lock --allow-net=127.0.0.1 \
//     --allow-read --allow-env --allow-sys scripts/mcp-oauth-stand.ts
//
// Exits 0 when every check holds. Prints no token: only their shapes.

import postgres from "npm:postgres@3.4.5";
import { Client } from "npm:@modelcontextprotocol/sdk@1.32.1/client/index.js";
import { StreamableHTTPClientTransport } from "npm:@modelcontextprotocol/sdk@1.32.1/client/streamableHttp.js";
import { UnauthorizedError } from "npm:@modelcontextprotocol/sdk@1.32.1/client/auth.js";

import { authorizationServerMetadata } from "../apps/web/src/features/oauth/metadata.ts";
import { isRedirectAllowed, redirectBack } from "../apps/web/src/features/oauth/redirect.ts";
import { createApiHandler, type RpcResult } from "../supabase/functions/api/handler.ts";
import { createMcpHandler } from "../supabase/functions/mcp/handler.ts";
import { createOAuthHandler } from "../supabase/functions/oauth/handler.ts";

const PORT = 8789;
const BASE = `http://127.0.0.1:${PORT}`;
const ISSUER = BASE;
const MCP_URL = `${BASE}/functions/v1/mcp`;
const REDIRECT = "http://127.0.0.1:53682/callback";
const HOST = "b1199999-0000-4000-8000-00000000000a";
const ADMIN = "b1199999-0000-4000-8000-000000000001";
const LIMIT_MS = 5 * 60_000;
const PEPPER = `${crypto.randomUUID()}${crypto.randomUUID()}`;

// ---------- the stand's database, never committed ----------

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
setTimeout(() => {
  console.error("time limit");
  void rollbackAndExit(1);
}, LIMIT_MS);

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

/** As scripts/api-stand-server.ts calls a function — and, given a user, as that user. */
function rpc(fn: string, args: Record<string, unknown>, asUser?: string): Promise<RpcResult> {
  return serial(async () => {
    const types = await typesOf(fn);
    const names = Object.keys(args).filter((name) => types.has(name));
    const values: unknown[] = [];
    const parts = names.map((name) => {
      const type = types.get(name) as string;
      values.push(JSON.stringify(args[name] ?? null));
      const n = values.length;
      return type.endsWith("[]")
        ? `${name} => (case when jsonb_typeof($${n}::text::jsonb) = 'array' then coalesce((select array_agg(x)::${type} from jsonb_array_elements_text($${n}::text::jsonb) x), '{}') end)`
        : `${name} => ($${n}::text::jsonb #>> '{}')::${type}`;
    });
    await db.unsafe("savepoint call");
    try {
      if (asUser !== undefined) {
        await db.unsafe(
          `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
          [JSON.stringify({ sub: asUser, role: "authenticated" }), asUser],
        );
      }
      const rows = await db.unsafe(`select public.${fn}(${parts.join(", ")})::text as r`, values as never[]);
      await db.unsafe("release savepoint call");
      const text = rows[0]?.r as string | null;
      return { data: text === null || text === undefined || text === "" ? null : JSON.parse(text), error: null };
    } catch (error) {
      await db.unsafe("rollback to savepoint call");
      const e = error as { code?: string; message?: string; hint?: string };
      return { data: null, error: { code: e.code ?? undefined, message: e.message, hint: e.hint } };
    } finally {
      await db.unsafe("select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)");
    }
  });
}

function query(text: string): Promise<postgres.Row[]> {
  return serial(() => db.unsafe(text) as Promise<postgres.Row[]>);
}

await query(`insert into public.hosts (id, name) values ('${HOST}', 'OAuth stand')`);
await query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at,
                                     raw_user_meta_data, raw_app_meta_data)
             values ('${ADMIN}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                     'oauth.stand@synthetic.local', 'x', now(), now(), '{"full_name":"Stand Admin"}', '{"role":"admin"}')`);
await query(`update public.profiles set host_id = '${HOST}' where id = '${ADMIN}'`);
await query(`insert into public.properties (id, host_id, name, timezone)
             values (900919001, '${HOST}', 'Stand House', 'Europe/Prague')`);

// ---------- the server ----------

const quiet = (work: Promise<unknown>) => void work.catch(() => undefined);
const mcp = createMcpHandler({
  api: createApiHandler({ rpc, pepper: PEPPER, channel: "mcp", defer: quiet }),
  oauth: { issuer: ISSUER, resource: MCP_URL },
});
const rest = createApiHandler({ rpc, pepper: PEPPER, defer: quiet });
const oauth = createOAuthHandler({ rpc, pepper: PEPPER, resource: MCP_URL });
const seen: string[] = [];

/** What the panel's consent page does on «Allow», for a registered client. */
async function consent(url: URL): Promise<Response> {
  const p = url.searchParams;
  const clientId = p.get("client_id") ?? "";
  const redirectUri = p.get("redirect_uri") ?? "";
  const registered = (await rpc("oauth_client", { p_client_id: clientId })).data as
    | { client_name: string | null; redirect_uris: string[] }
    | null;
  if (registered === null || !isRedirectAllowed(registered.redirect_uris, redirectUri)) {
    return new Response("refused", { status: 400 });
  }
  if (p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256") {
    return new Response("not S256 code flow", { status: 400 });
  }
  const answer = await rpc("oauth_authorize", {
    p_client_id: clientId,
    p_client_name: registered.client_name,
    p_redirect_uri: redirectUri,
    p_code_challenge: p.get("code_challenge"),
    p_resource: p.get("resource") ?? MCP_URL,
    p_name: "Stand assistant",
    p_preset: "read_only",
    p_scopes: [],
  }, ADMIN);
  if (answer.error !== null) {
    return new Response(`oauth_authorize: ${JSON.stringify(answer.error)}`, { status: 500 });
  }
  const code = (answer.data as { code: string }).code;
  return new Response(null, {
    status: 302,
    headers: { Location: redirectBack(redirectUri, { code, state: p.get("state"), iss: ISSUER }) },
  });
}

const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen: () => {} }, async (request) => {
  const url = new URL(request.url);
  let response: Response;
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    response = Response.json(authorizationServerMetadata(ISSUER, BASE));
  } else if (url.pathname.startsWith("/functions/v1/mcp")) {
    response = await mcp(request);
  } else if (url.pathname.startsWith("/functions/v1/oauth/")) {
    response = await oauth(request);
  } else if (url.pathname.startsWith("/functions/v1/api/")) {
    response = await rest(request);
  } else if (url.pathname === "/oauth/authorize") {
    response = await consent(url);
  } else {
    response = new Response("not found", { status: 404 });
  }
  seen.push(`${request.method} ${url.pathname} ${response.status}`);
  return response;
});

// ---------- the checks ----------

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === "" ? "" : ` — ${detail}`}`);
  if (!ok) {
    failed += 1;
  }
}

interface Tokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
}

/** The SDK's OAuthClientProvider, in memory: a program on this computer, as Claude Code is. */
class StandProvider {
  info: Record<string, unknown> | undefined;
  saved: Tokens | undefined;
  verifier = "";
  authorizationUrl: URL | undefined;
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata() {
    return {
      client_name: "Stand client",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() {
    return "stand-state";
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: Record<string, unknown>) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: Tokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

function toolJson(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

try {
  // The server says where to sign in.
  const bare = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  await bare.body?.cancel();
  check("an unsigned request is a 401 that points at the metadata",
    bare.status === 401 &&
      (bare.headers.get("WWW-Authenticate") ?? "").includes(`resource_metadata="${MCP_URL}/.well-known/oauth-protected-resource"`));

  const provider = new StandProvider();
  const first = new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: provider as never });
  let refused = false;
  try {
    await new Client({ name: "stand", version: "1.0.0" }).connect(first);
  } catch (error) {
    refused = error instanceof UnauthorizedError;
  }
  check("the SDK finds the sign-in and registers itself", refused && typeof provider.info?.client_id === "string" &&
    String(provider.info?.client_id).startsWith("woomc_"));
  const asked = provider.authorizationUrl;
  check("it asks for this server, with PKCE S256",
    asked !== undefined && asked.origin === ISSUER && asked.pathname === "/oauth/authorize" &&
      asked.searchParams.get("resource") === MCP_URL &&
      asked.searchParams.get("code_challenge_method") === "S256", String(asked));

  const allowed = await fetch(asked as URL, { redirect: "manual" });
  await allowed.body?.cancel();
  const back = new URL(allowed.headers.get("Location") ?? "about:blank");
  check("«Allow» sends the browser back with a code, the state and the issuer",
    allowed.status === 302 && back.origin + back.pathname === REDIRECT &&
      /^woomcd_[0-9a-f]{64}$/.test(back.searchParams.get("code") ?? "") &&
      back.searchParams.get("state") === "stand-state" && back.searchParams.get("iss") === ISSUER,
    `${allowed.status}`);

  await first.finishAuth(back.searchParams.get("code") as string);
  check("the code buys an access token and a refresh token",
    /^woomat_[A-Za-z0-9_-]{43}$/.test(provider.saved?.access_token ?? "") &&
      /^woomrt_[A-Za-z0-9_-]{43}$/.test(provider.saved?.refresh_token ?? "") &&
      provider.saved?.token_type === "Bearer" && provider.saved?.expires_in === 3600);

  const client = new Client({ name: "stand", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: provider as never }));
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  check("read only shows the reading tools and no writing one",
    tools.includes("list_cleanings") && !tools.includes("create_task") && !tools.includes("assign_cleaning"),
    tools.join(","));
  const me = toolJson(await client.callTool({ name: "get_me", arguments: {} })).data as Record<string, unknown>;
  check("get_me names the connection and the company",
    (me?.key as Record<string, unknown>)?.name === "Stand assistant" &&
      (me?.company as Record<string, unknown>)?.name === "OAuth stand", JSON.stringify(me));

  const restAnswer = await fetch(`${BASE}/functions/v1/api/v1/me`, {
    headers: { Authorization: `Bearer ${provider.saved?.access_token}` },
  });
  await restAnswer.body?.cancel();
  check("the REST API refuses the MCP server's token", restAnswer.status === 401, String(restAnswer.status));

  const listed = (await rpc("list_api_keys", {}, ADMIN)).data as Record<string, unknown>[];
  const connection = listed.find((key) => key.kind === "oauth");
  check("Settings → API lists the connection with its client",
    connection?.name === "Stand assistant" && connection?.client_name === "Stand client" && connection?.prefix === null);

  // The hour runs out: the SDK meets a 401 and refreshes.
  const oldRefresh = provider.saved?.refresh_token;
  await query("update public.oauth_tokens set expires_at = now() - interval '1 second' where kind = 'access'");
  const properties = toolJson(await client.callTool({ name: "list_properties", arguments: {} }));
  check("an expired access token is refreshed and the call goes through",
    provider.saved?.refresh_token !== oldRefresh &&
      JSON.stringify(properties).includes("Stand House"), JSON.stringify(properties).slice(0, 200));
  const spent = await query("select count(*)::int as n from public.oauth_tokens where kind = 'refresh' and used_at is not null");
  check("the old refresh token is spent", spent[0]?.n === 1, JSON.stringify(spent));

  await rpc("revoke_api_key", { p_id: connection?.id }, ADMIN);
  let stopped = false;
  try {
    await client.callTool({ name: "get_me", arguments: {} });
  } catch {
    stopped = true;
  }
  check("a revoked connection is stopped at once", stopped);

  console.log(`\nrequests: ${seen.join(" | ")}`);
} catch (error) {
  failed += 1;
  console.error(`FAIL thrown: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
} finally {
  await server.shutdown();
}

console.log(failed === 0 ? "\nall checks hold" : `\n${failed} failed`);
await rollbackAndExit(failed === 0 ? 0 : 1);
