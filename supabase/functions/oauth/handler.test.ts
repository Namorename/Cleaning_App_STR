import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

import { hmacHex } from "../_shared/api-key.ts";
import { createOAuthHandler, type OAuthDeps, readRegistration, redirectUriProblem, type RpcResult } from "./handler.ts";

/**
 * The token and registration endpoints over a database that answers what the
 * test says. The PKCE challenge and the code's digest below were computed
 * apart, with Node's crypto, so the test does not check the code against itself.
 */

const PEPPER = "p".repeat(32);
const BASE = "http://localhost/functions/v1/oauth";
const RESOURCE = "https://project.supabase.co/functions/v1/mcp";
const CODE = `woomcd_${"ab".repeat(32)}`;
const CODE_DIGEST = "538c6cf73140413189ba1042d01c92bcb634c0e268d08466f5ace50deac72c67";
const VERIFIER = "woom-test-verifier-0123456789_abcdefghijklmnopqrstuvwxyz";
const CHALLENGE = "1X0gCE7CRP3pAIDpu5IApkWHjz5I2NK-Kt83rBdqYJ4";
const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

interface Call {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

function setup(answers: Record<string, (args: Record<string, unknown>) => RpcResult> = {}, overrides: Partial<OAuthDeps> = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const deps: OAuthDeps = {
    pepper: PEPPER,
    resource: RESOURCE,
    logError: (line) => logs.push(line),
    rpc: (fn, args) => {
      calls.push({ fn, args });
      const answer = answers[fn];
      return Promise.resolve(answer === undefined ? { data: { ok: true, expires_in: 3600 }, error: null } : answer(args));
    },
    ...overrides,
  };
  return { handler: createOAuthHandler(deps), calls, logs };
}

function form(fields: Record<string, string>, path = "/token", headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

function codeGrant(extra: Record<string, string> = {}): Request {
  return form({
    grant_type: "authorization_code",
    code: CODE,
    code_verifier: VERIFIER,
    client_id: CLAUDE,
    redirect_uri: CALLBACK,
    resource: RESOURCE,
    ...extra,
  });
}

function register(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

// ---------- routing ----------

Deno.test("a preflight is answered for any page, without the database", async () => {
  const { handler, calls } = setup();
  const response = await handler(new Request(`${BASE}/token`, { method: "OPTIONS" }));
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(calls.length, 0);
});

Deno.test("only POST to the two endpoints is served", async () => {
  const { handler, calls } = setup();
  assertEquals((await handler(new Request(`${BASE}/token`))).status, 405);
  assertEquals((await handler(new Request(`${BASE}/authorize`, { method: "POST" }))).status, 404);
  assertEquals((await handler(new Request("http://localhost/oauth", { method: "POST" }))).status, 404);
  assertEquals(calls.length, 0);
});

Deno.test("without the pepper nothing is issued", async () => {
  const { handler, calls, logs } = setup({}, { pepper: null });
  const response = await handler(codeGrant());
  assertEquals(response.status, 500);
  assertEquals((await json(response)).error, "server_error");
  assertEquals(calls.length, 0);
  assertEquals(logs.length, 1);
});

// ---------- the code grant ----------

Deno.test("a code, its verifier and the client's own redirect buy a pair of tokens", async () => {
  const { handler, calls } = setup();
  const response = await handler(codeGrant());
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  const body = await json(response);
  assertMatch(String(body.access_token), /^woomat_[A-Za-z0-9_-]{43}$/);
  assertMatch(String(body.refresh_token), /^woomrt_[A-Za-z0-9_-]{43}$/);
  assertEquals(body.token_type, "Bearer");
  assertEquals(body.expires_in, 3600);

  assertEquals(calls.length, 1);
  const args = calls[0].args;
  assertEquals(calls[0].fn, "oauth_issue_tokens");
  assertEquals(args.p_code_digest, CODE_DIGEST);
  assertEquals(args.p_challenge, CHALLENGE);
  assertEquals(args.p_client_id, CLAUDE);
  assertEquals(args.p_redirect_uri, CALLBACK);
  assertEquals(args.p_resource, RESOURCE);
  assertEquals(args.p_access_digest, await hmacHex(PEPPER, String(body.access_token)));
  assertEquals(args.p_refresh_digest, await hmacHex(PEPPER, String(body.refresh_token)));
});

Deno.test("the database's refusal is the client's invalid_grant or invalid_target", async () => {
  for (const error of ["invalid_grant", "invalid_target"]) {
    const { handler } = setup({ oauth_issue_tokens: () => ({ data: { ok: false, error }, error: null }) });
    const response = await handler(codeGrant());
    assertEquals(response.status, 400);
    assertEquals((await json(response)).error, error);
  }
});

Deno.test("a token for another server is refused before the database is asked", async () => {
  const { handler, calls } = setup();
  const response = await handler(codeGrant({ resource: "https://other.example/mcp" }));
  assertEquals(response.status, 400);
  assertEquals((await json(response)).error, "invalid_target");
  assertEquals(calls.length, 0);
});

Deno.test("the resource is compared as RFC 8707 says: case of the host and a trailing slash do not matter", async () => {
  const { handler, calls } = setup();
  const response = await handler(codeGrant({ resource: "HTTPS://Project.Supabase.co/functions/v1/mcp/" }));
  assertEquals(response.status, 200);
  assertEquals(calls[0].args.p_resource, RESOURCE);
});

Deno.test("without a resource the token is still for this server", async () => {
  const { handler, calls } = setup();
  const request = form({
    grant_type: "authorization_code",
    code: CODE,
    code_verifier: VERIFIER,
    client_id: CLAUDE,
    redirect_uri: CALLBACK,
  });
  assertEquals((await handler(request)).status, 200);
  assertEquals(calls[0].args.p_resource, RESOURCE);
});

Deno.test("no verifier, no client or redirect, or a code not of ours: refused before the database", async () => {
  const { handler, calls } = setup();
  const cases: [Record<string, string>, string][] = [
    [{ code_verifier: "short" }, "invalid_request"],
    [{ client_id: "" }, "invalid_request"],
    [{ redirect_uri: "" }, "invalid_request"],
    [{ code: "woomcd_not-hex" }, "invalid_grant"],
  ];
  for (const [extra, error] of cases) {
    const response = await handler(codeGrant(extra));
    assertEquals(response.status, 400);
    assertEquals((await json(response)).error, error);
  }
  assertEquals(calls.length, 0);
});

Deno.test("the body is a form, each parameter once, and the grant one of two", async () => {
  const { handler, calls } = setup();
  const asJson = new Request(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code" }),
  });
  assertEquals((await json(await handler(asJson))).error, "invalid_request");

  const twice = new Request(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token&grant_type=authorization_code",
  });
  assertEquals((await json(await handler(twice))).error, "invalid_request");
  assertEquals((await json(await handler(form({ grant_type: "client_credentials" })))).error, "unsupported_grant_type");
  assertEquals((await json(await handler(form({})))).error, "invalid_request");
  assertEquals(calls.length, 0);
});

Deno.test("a secret some library sends anyway is ignored, not trusted", async () => {
  const { handler } = setup();
  const response = await handler(codeGrant({ client_secret: "anything" }));
  assertEquals(response.status, 200);
});

Deno.test("a body over the cap is refused before it is read whole", async () => {
  const { handler, calls } = setup();
  const response = await handler(form({ grant_type: "refresh_token", refresh_token: "x".repeat(17 * 1024) }));
  assertEquals(response.status, 413);
  assertEquals(calls.length, 0);
});

Deno.test("a failing database is a 500 that names the function, never a value", async () => {
  const { handler, logs } = setup({ oauth_issue_tokens: () => ({ data: null, error: { code: "57014" } }) });
  const response = await handler(codeGrant());
  assertEquals(response.status, 500);
  assertEquals(logs, ["oauth: oauth_issue_tokens failed with 57014"]);
});

// ---------- the refresh grant ----------

Deno.test("a refresh token is sent as its digest, with the new pair's", async () => {
  const { handler, calls } = setup();
  const refresh = `woomrt_${"R".repeat(43)}`;
  const response = await handler(form({ grant_type: "refresh_token", refresh_token: refresh }));
  assertEquals(response.status, 200);
  const body = await json(response);
  assert(body.refresh_token !== refresh);
  assertEquals(calls[0].fn, "oauth_refresh_tokens");
  assertEquals(calls[0].args.p_refresh_digest, await hmacHex(PEPPER, refresh));
  assertEquals(calls[0].args.p_client_id, null);
  assertEquals(calls[0].args.p_access_digest, await hmacHex(PEPPER, String(body.access_token)));
  assertEquals(calls[0].args.p_new_refresh_digest, await hmacHex(PEPPER, String(body.refresh_token)));
});

Deno.test("a refresh token not of ours, or one the database refuses, is invalid_grant", async () => {
  const fresh = setup();
  const malformed = await fresh.handler(form({ grant_type: "refresh_token", refresh_token: "woomat_x" }));
  assertEquals((await json(malformed)).error, "invalid_grant");
  assertEquals(fresh.calls.length, 0);

  const { handler } = setup({ oauth_refresh_tokens: () => ({ data: { ok: false, error: "invalid_grant" }, error: null }) });
  const refused = await handler(
    form({ grant_type: "refresh_token", refresh_token: `woomrt_${"R".repeat(43)}`, client_id: CLAUDE }),
  );
  assertEquals(refused.status, 400);
  assertEquals((await json(refused)).error, "invalid_grant");
});

// ---------- registration ----------

Deno.test("a public client registers its redirects, counted by its address", async () => {
  const { handler, calls } = setup({
    oauth_register_client: (args) => ({
      data: {
        ok: true,
        client_id: "woomc_0123456789abcdef0123456789abcdef",
        client_name: args.p_client_name,
        redirect_uris: args.p_redirect_uris,
        client_id_issued_at: 1794254448,
      },
      error: null,
    }),
  });
  const response = await handler(register({
    client_name: " Cursor ",
    redirect_uris: ["http://127.0.0.1:33418/callback", "cursor://anysphere.cursor-mcp/oauth/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }));
  assertEquals(response.status, 201);
  assertEquals(await json(response), {
    client_id: "woomc_0123456789abcdef0123456789abcdef",
    client_id_issued_at: 1794254448,
    client_name: "Cursor",
    redirect_uris: ["http://127.0.0.1:33418/callback", "cursor://anysphere.cursor-mcp/oauth/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  assertEquals(calls[0].args.p_ip_hash, await hmacHex(PEPPER, "ip:203.0.113.7"));
});

Deno.test("a refused registration says which part, before the database is asked", async () => {
  const { handler, calls } = setup();
  const cases: [unknown, string][] = [
    [{ redirect_uris: ["http://example.com/cb"] }, "invalid_redirect_uri"],
    [{ redirect_uris: ["javascript:alert(1)"] }, "invalid_redirect_uri"],
    [{ redirect_uris: ["https://a.example/cb#frag"] }, "invalid_redirect_uri"],
    [{ redirect_uris: [] }, "invalid_redirect_uri"],
    [{ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" }, "invalid_client_metadata"],
    [{ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] }, "invalid_client_metadata"],
    [{ redirect_uris: ["https://a.example/cb"], client_name: "x".repeat(101) }, "invalid_client_metadata"],
    [["https://a.example/cb"], "invalid_client_metadata"],
  ];
  for (const [body, error] of cases) {
    const response = await handler(register(body));
    assertEquals(response.status, 400, JSON.stringify(body));
    assertEquals((await json(response)).error, error, JSON.stringify(body));
  }
  assertEquals(calls.length, 0);
});

Deno.test("too many registrations from one address wait an hour", async () => {
  const { handler } = setup({ oauth_register_client: () => ({ data: { ok: false, code: "rate-limited" }, error: null }) });
  const response = await handler(register({ redirect_uris: ["https://a.example/cb"] }));
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "3600");
});

Deno.test("redirects: https anywhere, http to this computer, a program's own scheme; nothing a browser runs", () => {
  for (const ok of ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3118/callback", "http://127.0.0.1/cb",
                    "http://[::1]:8080/cb", "cursor://anysphere.cursor-mcp/oauth/callback", "vscode://x/y"]) {
    assertEquals(redirectUriProblem(ok), null, ok);
  }
  for (const bad of ["http://claude.ai/cb", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd",
                     "https://a.example/cb#x", "https://user:pw@a.example/cb", "/relative", "", 42]) {
    assert(redirectUriProblem(bad) !== null, String(bad));
  }
});

Deno.test("a registration keeps each redirect once and an empty name as none", () => {
  const read = readRegistration({ client_name: "  ", redirect_uris: ["https://a.example/cb", "https://a.example/cb"] });
  assertEquals(read, { clientName: null, redirectUris: ["https://a.example/cb"] });
});
