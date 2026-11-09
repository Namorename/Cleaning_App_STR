/**
 * The authorization server's two endpoints that need the pepper
 * (docs/mcp-oauth.md): the token endpoint (RFC 6749 §3.2, OAuth 2.1) and
 * dynamic client registration (RFC 7591). The metadata and the consent page
 * are the panel's; codes, tokens and clients are the database's.
 *
 * Public clients only: no client secret, PKCE S256 always. A token is made
 * here and only its HMAC goes to the database. Pure: the database comes in as
 * a dependency, so the tests run without a network. Nothing about a request
 * is logged but an internal failure's kind.
 */

import { hmacHex, sha256Hex } from "../_shared/api-key.ts";
import {
  ACCESS_TOKEN_PREFIX,
  canonicalUrl,
  CODE_PATTERN,
  newToken,
  pkceChallenge,
  REFRESH_TOKEN_PATTERN,
  REFRESH_TOKEN_PREFIX,
  VERIFIER_PATTERN,
} from "../_shared/mcp-oauth.ts";

export interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly code?: string } | null;
}

export interface OAuthDeps {
  /** A database function by name, called as service_role. */
  readonly rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  /** API_KEY_PEPPER; null answers 500 to everything (a deployment mistake). */
  readonly pepper: string | null;
  /** The MCP server's canonical URL: the one resource tokens are issued for. */
  readonly resource: string;
  /** Where an internal failure's kind goes; never a value. */
  readonly logError?: (line: string) => void;
}

const MAX_BODY_BYTES = 16 * 1024;
const MAX_CLIENT_NAME = 100;
const MAX_REDIRECT_URIS = 5;
const MAX_URI_LENGTH = 2048;
const REGISTRATION_RETRY_SECONDS = 3600;
/** The function is reached as /oauth/… on the platform and /functions/v1/oauth/… through the gateway. */
const PREFIXES = ["/functions/v1/oauth", "/oauth"];
const IP = /^[0-9A-Fa-f.:]{2,45}$/;
/**
 * The redirects a browser may be sent to, as the database's oauth_redirect_safe
 * and the panel's isSafeRedirectUri say them: https, plain http to this
 * computer, or a program's own scheme — reverse-domain, or an editor's short one.
 */
const HTTPS = /^https:\/\/[^/?:]+/;
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(\/|$)/;
const PROGRAM_SCHEME = /^((cursor|vscode|vscode-insiders):\/\/|[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+:)/;
/** Control and format characters (bidi overrides among them): a name is shown to an admin. */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const GRANT_TYPES = ["authorization_code", "refresh_token"];

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};

function json(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      ...headers,
    },
  });
}

/** An RFC 6749 §5.2 / RFC 7591 §3.2.2 error. */
function oauthError(status: number, error: string, description: string, headers: Readonly<Record<string, string>> = {}) {
  return json(status, { error, error_description: description }, headers);
}

/** The body, read no further than the cap: this runs before anyone is known. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return null;
  }
  if (request.body === null) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** As the API counts addresses: the platform's header only, an IPv6 address by its /64. */
function clientIp(request: Request): string | null {
  const ip = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (!IP.test(ip)) {
    return null;
  }
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip;
}

function endpointOf(pathname: string): string | null {
  for (const prefix of PREFIXES) {
    if (pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length + 1).replace(/\/+$/, "");
    }
  }
  return null;
}

/**
 * Why a redirect URI cannot be registered, or null when it can: https
 * anywhere, plain http to this computer only (RFC 8252 §7.3), or a program's
 * own scheme (§7.1) — never one a browser would run or read itself
 * (javascript:, data:, file:, mailto: …). No fragment, no credentials.
 */
export function redirectUriProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URI_LENGTH) {
    return "a redirect URI is a string of 1 to 2048 characters";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "a redirect URI must be an absolute URI";
  }
  if (url.hash !== "" || value.includes("#")) {
    return "a redirect URI has no fragment";
  }
  if (url.username !== "" || url.password !== "" || /^[a-z][a-z0-9+.-]*:\/\/[^/?]*@/.test(value)) {
    return "a redirect URI carries no credentials";
  }
  if (HTTPS.test(value) || LOOPBACK.test(value) || PROGRAM_SCHEME.test(value)) {
    return null;
  }
  return url.protocol === "http:"
    ? "plain http is allowed for this computer only (localhost)"
    : "a redirect URI is https, http to this computer, or a program's own scheme";
}

/** A name as the admin will read it: no control or bidi characters, at most 100 long. */
export function cleanClientName(value: string): string | null {
  const name = value.replace(HIDDEN_CHARACTERS, "").trim();
  return name === "" ? null : name.slice(0, MAX_CLIENT_NAME);
}

interface Registration {
  readonly clientName: string | null;
  readonly redirectUris: readonly string[];
}

interface RegistrationRefusal {
  readonly error: "invalid_redirect_uri" | "invalid_client_metadata";
  readonly description: string;
}

function refuse(error: RegistrationRefusal["error"], description: string): RegistrationRefusal {
  return { error, description };
}

/** RFC 7591 §2: what we keep of a registration, or why it is refused (§3.2.2). */
export function readRegistration(body: unknown): Registration | RegistrationRefusal {
  if (!isRecord(body)) {
    return refuse("invalid_client_metadata", "the body must be a JSON object");
  }
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return refuse("invalid_redirect_uri", "redirect_uris must list 1 to 5 URIs");
  }
  for (const uri of uris) {
    const problem = redirectUriProblem(uri);
    if (problem !== null) {
      return refuse("invalid_redirect_uri", problem);
    }
  }
  // RFC 7591 §3.2.1 lets the server replace what it does not offer: every
  // client is public (the answer says "none"), extra grant types are dropped.
  // Without the code grant, though, there is nothing to register for.
  const grants = body.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || !grants.includes("authorization_code"))) {
    return refuse("invalid_client_metadata", "grant_types must include authorization_code");
  }
  const responses = body.response_types;
  if (responses !== undefined && (!Array.isArray(responses) || responses.some((type) => type !== "code"))) {
    return refuse("invalid_client_metadata", "response_types may be code only");
  }
  const name = body.client_name;
  if (name !== undefined && name !== null && (typeof name !== "string" || name.trim().length > MAX_CLIENT_NAME)) {
    return refuse("invalid_client_metadata", "client_name is a string of at most 100 characters");
  }
  return {
    clientName: typeof name === "string" ? cleanClientName(name) : null,
    redirectUris: [...new Set(uris as string[])],
  };
}

/** Form parameters, each at most once (RFC 6749 §3.2): null if one repeats. */
function readForm(text: string): Map<string, string> | null {
  const form = new Map<string, string>();
  for (const [name, value] of new URLSearchParams(text)) {
    if (form.has(name)) {
      return null;
    }
    form.set(name, value);
  }
  return form;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createOAuthHandler(deps: OAuthDeps): (request: Request) => Promise<Response> {
  const logError = deps.logError ?? ((line: string) => console.error(line));
  const resource = canonicalUrl(deps.resource);

  async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const { data, error } = await deps.rpc(fn, args);
    if (error !== null || !isRecord(data)) {
      logError(`oauth: ${fn} failed with ${error?.code ?? "no object"}`);
      return null;
    }
    return data;
  }

  /** Two fresh tokens and their digests. */
  async function newPair(pepper: string) {
    const access = newToken(ACCESS_TOKEN_PREFIX);
    const refresh = newToken(REFRESH_TOKEN_PREFIX);
    return {
      access,
      refresh,
      accessDigest: await hmacHex(pepper, access),
      refreshDigest: await hmacHex(pepper, refresh),
    };
  }

  function issued(answer: Record<string, unknown>, access: string, refresh: string): Response {
    if (answer.ok !== true) {
      const error = answer.error === "invalid_target" ? "invalid_target" : "invalid_grant";
      return oauthError(400, error, error === "invalid_target"
        ? "The token is for the woom MCP server only"
        : "The code or refresh token is invalid, expired, spent or not this client's");
    }
    return json(200, {
      access_token: access,
      token_type: "Bearer",
      expires_in: Number(answer.expires_in) || 3600,
      refresh_token: refresh,
    });
  }

  async function token(request: Request, pepper: string): Promise<Response> {
    if (!/^application\/x-www-form-urlencoded(\s*;.*)?$/i.test((request.headers.get("Content-Type") ?? "").trim())) {
      return oauthError(400, "invalid_request", "The body must be application/x-www-form-urlencoded");
    }
    const text = await readBody(request);
    if (text === null) {
      return oauthError(413, "invalid_request", `The body is larger than ${MAX_BODY_BYTES} bytes`);
    }
    const form = readForm(text);
    if (form === null) {
      return oauthError(400, "invalid_request", "A parameter was sent more than once");
    }
    // Clients are public: a secret some library sends anyway proves nothing and
    // is ignored. The code is bound to the client, its redirect and its PKCE.

    const askedResource = form.get("resource");
    if (askedResource !== undefined && (resource === null || canonicalUrl(askedResource) !== resource)) {
      return oauthError(400, "invalid_target", "The token is for the woom MCP server only");
    }

    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      const code = form.get("code") ?? "";
      const verifier = form.get("code_verifier") ?? "";
      const clientId = form.get("client_id") ?? "";
      const redirectUri = form.get("redirect_uri") ?? "";
      if (clientId === "" || redirectUri === "") {
        return oauthError(400, "invalid_request", "client_id and redirect_uri are required");
      }
      if (!VERIFIER_PATTERN.test(verifier)) {
        return oauthError(400, "invalid_request", "code_verifier is required (PKCE, RFC 7636)");
      }
      if (!CODE_PATTERN.test(code)) {
        return oauthError(400, "invalid_grant", "The code is invalid, expired or spent");
      }
      const pair = await newPair(pepper);
      const answer = await call("oauth_issue_tokens", {
        p_code_digest: await sha256Hex(code),
        p_client_id: clientId,
        p_redirect_uri: redirectUri,
        p_challenge: await pkceChallenge(verifier),
        p_resource: resource,
        p_access_digest: pair.accessDigest,
        p_refresh_digest: pair.refreshDigest,
      });
      return answer === null ? oauthError(500, "server_error", "Internal error") : issued(answer, pair.access, pair.refresh);
    }

    if (grant === "refresh_token") {
      const refresh = form.get("refresh_token") ?? "";
      if (!REFRESH_TOKEN_PATTERN.test(refresh)) {
        return oauthError(400, "invalid_grant", "The refresh token is invalid, expired or spent");
      }
      const pair = await newPair(pepper);
      const answer = await call("oauth_refresh_tokens", {
        p_refresh_digest: await hmacHex(pepper, refresh),
        p_client_id: form.get("client_id") || null,
        p_access_digest: pair.accessDigest,
        p_new_refresh_digest: pair.refreshDigest,
      });
      return answer === null ? oauthError(500, "server_error", "Internal error") : issued(answer, pair.access, pair.refresh);
    }

    return grant === undefined
      ? oauthError(400, "invalid_request", "grant_type is required")
      : oauthError(400, "unsupported_grant_type", "Only authorization_code and refresh_token");
  }

  async function register(request: Request, pepper: string): Promise<Response> {
    if (!/^application\/json(\s*;.*)?$/i.test((request.headers.get("Content-Type") ?? "").trim())) {
      return oauthError(400, "invalid_client_metadata", "The body must be application/json");
    }
    const text = await readBody(request);
    if (text === null) {
      return oauthError(413, "invalid_client_metadata", `The body is larger than ${MAX_BODY_BYTES} bytes`);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return oauthError(400, "invalid_client_metadata", "The body is not valid JSON");
    }
    const registration = readRegistration(body);
    if ("error" in registration) {
      return oauthError(400, registration.error, registration.description);
    }
    const ip = clientIp(request);
    const answer = await call("oauth_register_client", {
      p_client_name: registration.clientName,
      p_redirect_uris: registration.redirectUris,
      p_ip_hash: ip === null ? null : await hmacHex(pepper, `ip:${ip}`),
    });
    if (answer === null) {
      return oauthError(500, "server_error", "Internal error");
    }
    if (answer.ok !== true) {
      return oauthError(429, "rate_limited", "Too many registrations; try again later", {
        "Retry-After": String(REGISTRATION_RETRY_SECONDS),
      });
    }
    return json(201, {
      client_id: answer.client_id,
      client_id_issued_at: answer.client_id_issued_at,
      ...(answer.client_name === null ? {} : { client_name: answer.client_name }),
      redirect_uris: answer.redirect_uris,
      grant_types: GRANT_TYPES,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  }

  return async function handle(request: Request): Promise<Response> {
    try {
      const endpoint = endpointOf(new URL(request.url).pathname);
      if (endpoint !== "token" && endpoint !== "register") {
        return oauthError(404, "invalid_request", "No OAuth endpoint at this path");
      }
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (request.method !== "POST") {
        return json(405, { error: "invalid_request", error_description: "POST only" }, { Allow: "POST, OPTIONS" });
      }
      if (deps.pepper === null || resource === null) {
        logError("oauth: API_KEY_PEPPER or the MCP server's URL is missing");
        return oauthError(500, "server_error", "Internal error");
      }
      return endpoint === "token" ? await token(request, deps.pepper) : await register(request, deps.pepper);
    } catch (error) {
      logError(`oauth: ${error instanceof Error ? error.name : "unknown"} thrown`);
      return oauthError(500, "server_error", "Internal error");
    }
  };
}
