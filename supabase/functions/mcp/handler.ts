/**
 * The MCP server over HTTP (docs/mcp-server.md §2, §4).
 *
 * One endpoint, POST only, one JSON-RPC message per request, answered with
 * application/json; no session, no SSE. Who is calling is the API's question:
 * every request but a notification reaches the API's own handler, getMe for
 * the protocol's own methods and the operation itself for a tool call, so a
 * refused key is a 401 and a full bucket a 429 here exactly as there. Pure:
 * the API handler comes in as a dependency, so the tests run without a network.
 *
 * Nothing about a request is logged but an internal failure's kind; the API
 * writes its own request log (key id, operation, status, duration).
 */

import {
  decodeHeaderValue,
  type Era,
  errorOf,
  ERRORS,
  HEADERLESS_VERSION,
  INSTRUCTIONS,
  isRequest,
  type JsonRpcMessage,
  LEGACY_VERSIONS,
  META_CAPABILITIES,
  META_VERSION,
  MODERN_VERSION,
  modernResult,
  parseMessage,
  type RequestId,
  resultOf,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
} from "./protocol.ts";
import { type ApiFetch, type CallContext, type CallOutcome, callTool, keyScopes, listTools } from "./tools.ts";
import { type OAuthConfig, RESOURCE_METADATA_SUFFIX, resourceMetadataUrl } from "../_shared/mcp-oauth.ts";

export interface McpDeps {
  /** The API v1 handler (supabase/functions/api/handler.ts). */
  readonly api: ApiFetch;
  /**
   * Sign-in by OAuth (docs/mcp-oauth.md): the server's canonical URL and the
   * authorization server's issuer. With it a refusal points the client at the
   * Protected Resource Metadata (RFC 9728), which this function serves.
   */
  readonly oauth?: OAuthConfig;
  /** Where an internal failure's kind goes; never a value. */
  readonly logError?: (line: string) => void;
}

const MAX_BODY_BYTES = 64 * 1024;
/** The function is reached as /mcp on the platform and /functions/v1/mcp through the gateway. */
const PATHS = ["/functions/v1/mcp", "/mcp"];
const KEY_PARAMS = ["key", "api_key", "apikey", "access_token", "token"];
/** How long a client may keep the list of tools (it follows the key's scopes). */
const TOOLS_TTL_MS = 5 * 60_000;
const DISCOVER_TTL_MS = 60 * 60_000;
const BEARER = /^Bearer\s+\S+\s*$/i;
/** How long a client may keep the Protected Resource Metadata. */
const METADATA_MAX_AGE_SECONDS = 300;

const BASE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "application/json", ...headers },
  });
}

function empty(status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(null, { status, headers: { ...BASE_HEADERS, ...headers } });
}

/**
 * The body, read no further than the cap: this runs before the key is
 * known, so a chunked upload without a length must not be buffered whole.
 */
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

function paramsOf(message: JsonRpcMessage): Record<string, unknown> {
  const params = message.params;
  return typeof params === "object" && params !== null && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

/**
 * The 401's challenge (RFC 6750 §3): no error code when nothing was sent, and
 * — with OAuth — where the Protected Resource Metadata is (RFC 9728 §5.1), the
 * only way a client learns where to sign in: the platform cannot serve
 * /.well-known at the project's root.
 */
export function challengeOf(code: string, oauth: OAuthConfig | undefined): string {
  const parts = ['Bearer realm="woom"'];
  if (code !== "missing-key") {
    parts.push('error="invalid_token"');
  }
  if (oauth !== undefined) {
    parts.push(`resource_metadata="${resourceMetadataUrl(oauth.resource)}"`);
  }
  return parts.join(", ");
}

/** RFC 9728 §2: the server, who signs clients in for it, how tokens travel. */
export function protectedResourceMetadata(oauth: OAuthConfig): Record<string, unknown> {
  return {
    resource: oauth.resource,
    authorization_servers: [oauth.issuer],
    bearer_methods_supported: ["header"],
    resource_name: "woom",
    resource_documentation: `${oauth.issuer}/developers/mcp`,
  };
}

export function createMcpHandler(deps: McpDeps): (request: Request) => Promise<Response> {
  const logError = deps.logError ?? ((line: string) => console.error(line));

  /** The metadata, for anyone and any page: it says nothing secret. */
  function metadata(request: Request): Response {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
    if (deps.oauth === undefined) {
      return json(404, errorOf(null, ERRORS.invalidRequest, "This server takes API keys only"), cors);
    }
    if (request.method === "OPTIONS") {
      return empty(204, { ...cors, "Access-Control-Max-Age": "600" });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return empty(405, { ...cors, Allow: "GET, OPTIONS" });
    }
    return json(200, protectedResourceMetadata(deps.oauth), {
      ...cors,
      "Cache-Control": `public, max-age=${METADATA_MAX_AGE_SECONDS}`,
    });
  }

  /** A call's outcome as the client gets it. */
  function answer(id: RequestId, era: Era, outcome: CallOutcome, toolName?: string): Response {
    switch (outcome.kind) {
      case "result": {
        const result = outcome.result as unknown as Record<string, unknown>;
        return json(200, resultOf(id, era === "modern" ? modernResult(result) : result));
      }
      case "unknown-tool":
        return json(200, errorOf(id, ERRORS.invalidParams, `Unknown tool: ${toolName ?? ""}`.trim()));
      case "http":
        return outcome.status === 429
          ? json(429, errorOf(id, ERRORS.rateLimited, "Too many requests", { code: outcome.code }), outcome.headers)
          : json(
            401,
            errorOf(id, ERRORS.unauthorized, "The API key was refused", { code: outcome.code }),
            { ...outcome.headers, "WWW-Authenticate": challengeOf(outcome.code, deps.oauth) },
          );
      case "internal":
        return json(500, errorOf(id, ERRORS.internal, "Internal error"));
    }
  }

  /** The key's scopes, or the answer that refuses the request. */
  async function scopesOr(id: RequestId, era: Era, ctx: CallContext): Promise<string[] | Response> {
    const scopes = await keyScopes(ctx);
    return scopes.ok ? scopes.scopes : answer(id, era, scopes.outcome);
  }

  async function legacy(message: JsonRpcMessage, id: RequestId, ctx: CallContext): Promise<Response> {
    const params = paramsOf(message);
    switch (message.method) {
      case "initialize": {
        const scopes = await scopesOr(id, "legacy", ctx);
        if (scopes instanceof Response) {
          return scopes;
        }
        const requested = params.protocolVersion;
        const protocolVersion = typeof requested === "string" && LEGACY_VERSIONS.includes(requested)
          ? requested
          : LEGACY_VERSIONS[0];
        return json(
          200,
          resultOf(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          }),
        );
      }
      case "ping": {
        const scopes = await scopesOr(id, "legacy", ctx);
        return scopes instanceof Response ? scopes : json(200, resultOf(id, {}));
      }
      case "tools/list": {
        const scopes = await scopesOr(id, "legacy", ctx);
        return scopes instanceof Response ? scopes : json(200, resultOf(id, { tools: listTools(scopes) }));
      }
      case "tools/call": {
        if (typeof params.name !== "string") {
          return json(200, errorOf(id, ERRORS.invalidParams, "params.name must be a tool's name"));
        }
        return answer(id, "legacy", await callTool(params.name, params.arguments, ctx), params.name);
      }
      default:
        return json(200, errorOf(id, ERRORS.methodNotFound, `Method not found: ${message.method}`));
    }
  }

  async function modern(
    message: JsonRpcMessage,
    id: RequestId,
    request: Request,
    ctx: CallContext,
  ): Promise<Response> {
    const method = message.method as string;
    const mismatch = (detail: string) => json(400, errorOf(id, ERRORS.headerMismatch, `Header mismatch: ${detail}`));
    if (request.headers.get("Mcp-Method") !== method) {
      return mismatch("the Mcp-Method header must name the body's method");
    }
    const params = paramsOf(message);
    const meta = typeof params._meta === "object" && params._meta !== null
      ? (params._meta as Record<string, unknown>)
      : {};
    if (meta[META_VERSION] !== MODERN_VERSION) {
      return mismatch(`_meta "${META_VERSION}" must match the MCP-Protocol-Version header`);
    }
    if (typeof meta[META_CAPABILITIES] !== "object" || meta[META_CAPABILITIES] === null) {
      return json(400, errorOf(id, ERRORS.invalidParams, `_meta "${META_CAPABILITIES}" is required`));
    }

    switch (method) {
      case "server/discover": {
        const scopes = await scopesOr(id, "modern", ctx);
        return scopes instanceof Response ? scopes : json(
          200,
          resultOf(
            id,
            modernResult({
              supportedVersions: SUPPORTED_VERSIONS,
              capabilities: { tools: {} },
              instructions: INSTRUCTIONS,
              ttlMs: DISCOVER_TTL_MS,
              cacheScope: "public",
            }),
          ),
        );
      }
      case "tools/list": {
        const scopes = await scopesOr(id, "modern", ctx);
        return scopes instanceof Response ? scopes : json(
          200,
          resultOf(id, modernResult({ tools: listTools(scopes), ttlMs: TOOLS_TTL_MS, cacheScope: "private" })),
        );
      }
      case "tools/call": {
        const header = request.headers.get("Mcp-Name");
        if (header === null || typeof params.name !== "string" || decodeHeaderValue(header) !== params.name) {
          return mismatch("the Mcp-Name header must name the body's tool");
        }
        return answer(id, "modern", await callTool(params.name, params.arguments, ctx), params.name);
      }
      default:
        return json(404, errorOf(id, ERRORS.methodNotFound, `Method not found: ${method}`));
    }
  }

  return async function handle(request: Request): Promise<Response> {
    let id: RequestId | null = null;
    try {
      const url = new URL(request.url);
      if (PATHS.some((path) => url.pathname === `${path}${RESOURCE_METADATA_SUFFIX}`)) {
        return metadata(request);
      }
      if (!PATHS.some((path) => url.pathname === path || url.pathname === `${path}/`)) {
        return json(404, errorOf(null, ERRORS.invalidRequest, "No MCP endpoint at this path"));
      }
      if (request.method !== "POST") {
        return empty(405, { Allow: "POST" });
      }
      // The clients are programs, not pages: a browser's request (it carries an
      // Origin) is refused, and no CORS header would let a page read an answer.
      if (request.headers.get("Origin") !== null) {
        return json(403, errorOf(null, ERRORS.invalidRequest, "Browser pages may not call the MCP server"));
      }
      if (KEY_PARAMS.some((name) => url.searchParams.has(name))) {
        return json(400, errorOf(null, ERRORS.invalidRequest, "An API key must not be sent in the URL"));
      }
      if (!/^application\/json(\s*;.*)?$/i.test((request.headers.get("Content-Type") ?? "").trim())) {
        return json(415, errorOf(null, ERRORS.invalidRequest, "The body must be application/json"));
      }
      const text = await readBody(request);
      if (text === null) {
        return json(413, errorOf(null, ERRORS.invalidRequest, `The body is larger than ${MAX_BODY_BYTES} bytes`));
      }
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return json(400, errorOf(null, ERRORS.parse, "The body is not valid JSON"));
      }
      const parsed = parseMessage(value);
      if (!parsed.ok) {
        return json(400, errorOf(null, ERRORS.invalidRequest, parsed.reason));
      }
      const message = parsed.message;
      if (message.method !== undefined && message.id === null) {
        // MCP forbids a null id: answering it as a notification would leave the client waiting.
        return json(400, errorOf(null, ERRORS.invalidRequest, "A request's id must not be null"));
      }
      id = isRequest(message) ? (message.id as RequestId) : null;

      const version = request.headers.get("MCP-Protocol-Version") ?? HEADERLESS_VERSION;
      if (!SUPPORTED_VERSIONS.includes(version)) {
        return json(
          400,
          errorOf(id, ERRORS.unsupportedVersion, "Unsupported protocol version", {
            supported: SUPPORTED_VERSIONS,
            requested: version,
          }),
        );
      }
      const era: Era = version === MODERN_VERSION ? "modern" : "legacy";
      const ctx: CallContext = {
        api: deps.api,
        authorization: request.headers.get("Authorization"),
        clientIp: request.headers.get("cf-connecting-ip"),
      };

      if (id === null) {
        // A notification, or a response to a request this server never sends.
        if (era === "modern" && message.method === undefined) {
          return json(400, errorOf(null, ERRORS.invalidRequest, "A client must not send JSON-RPC responses"));
        }
        if (ctx.authorization === null || !BEARER.test(ctx.authorization)) {
          return json(
            401,
            errorOf(null, ERRORS.unauthorized, "The API key was refused", { code: "missing-key" }),
            { "WWW-Authenticate": challengeOf("missing-key", deps.oauth) },
          );
        }
        return empty(202);
      }
      return era === "modern" ? await modern(message, id, request, ctx) : await legacy(message, id, ctx);
    } catch (error) {
      logError(`mcp: ${error instanceof Error ? error.name : "unknown"} thrown`);
      return json(500, errorOf(id, ERRORS.internal, "Internal error"));
    }
  };
}
