/**
 * The public API v1 over HTTP (docs/api-v1.md).
 *
 * The rules of who may see what live in the database: every api_v1_* function
 * takes the key's digest and derives the company, the scopes and the property
 * restriction itself. This handler reads the request strictly, passes the gate,
 * calls one function, and turns the answer into JSON or problem+json. Pure:
 * the database, the clock and the request ids come in as dependencies, so the
 * tests run it without a network.
 *
 * A key never reaches a log line: the token is hashed at once, and the only
 * thing ever written about a request is its key id, operation, status and
 * duration (api_log_request).
 */

import { hmacHex, sha256Hex, timingSafeEqual } from "../_shared/api-key.ts";
import { decodeCursor, encodeCursor, filterFingerprint } from "./cursor.ts";
import { checkScalar, DEFAULT_LIMIT, parseBody, parseQuery } from "./params.ts";
import { ApiProblem, PROBLEM_CONTENT_TYPE, problemFromDatabase, type ProblemCode, type RpcError } from "./problem.ts";
import { matchRoute, type Route } from "./routes.ts";

export interface RpcResult {
  readonly data: unknown;
  readonly error: RpcError | null;
}

export interface ApiDeps {
  /** A database function by name, called as service_role. */
  readonly rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  /** API_KEY_PEPPER; null answers 500 to everything (a deployment mistake). */
  readonly pepper: string | null;
  readonly now?: () => number;
  readonly newRequestId?: () => string;
  /** Where a 500's cause goes: the operation and the SQLSTATE, never a value. */
  readonly logError?: (line: string) => void;
  /** Work that may finish after the answer (the request log). */
  readonly defer?: (work: Promise<unknown>) => void;
}

const MAX_BODY_BYTES = 16 * 1024;
const MAX_TOKEN_LENGTH = 512;
const MAX_DATE_SPAN_DAYS = 366;
/** Names under which a key could be smuggled into a URL, and end up in a proxy's log. */
const KEY_PARAMS = ["key", "api_key", "apikey", "access_token", "token"];
/** The function is reached as /api/… on the platform and /functions/v1/api/… through the gateway. */
const PATH_PREFIXES = ["/functions/v1/api", "/api"];
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/;
const IP = /^[0-9A-Fa-f.:]{2,45}$/;
const LOGGED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const AUTH_CODES: ReadonlySet<string> = new Set([
  "missing-key",
  "invalid-key",
  "key-expired",
  "key-revoked",
  "key-suspended",
]);

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers":
    "RateLimit, RateLimit-Policy, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, " +
    "Retry-After, Idempotent-Replayed, X-Request-Id, Allow",
  "Access-Control-Max-Age": "600",
};

interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly objectId?: string | null;
}

function respond(
  status: number,
  body: unknown,
  contentType: string,
  headers: Readonly<Record<string, string>>,
): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": contentType, "Cache-Control": "no-store", ...headers },
  });
}

function readBearer(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (header === null) {
    return null;
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match === null ? "" : match[1];
}

/**
 * The caller's address, for the failed-authentication bucket only.
 *
 * Only the header the platform's edge sets: X-Real-IP and the left end of
 * X-Forwarded-For are whatever the caller wrote, and trusting them would let
 * anyone fill another address's bucket. An IPv6 address counts by its /64,
 * the block one customer usually holds, so rotating within it buys nothing.
 * No header, no bucket: the key is still checked.
 */
export function clientIp(request: Request): string | null {
  const ip = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (!IP.test(ip)) {
    return null;
  }
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip;
}

function stripPrefix(pathname: string): string {
  for (const prefix of PATH_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length) || "/";
    }
  }
  return pathname;
}

function rateHeaders(gate: Record<string, unknown>): Record<string, string> {
  const limit = Number(gate.limit);
  const remaining = Number(gate.remaining);
  const reset = Number(gate.reset);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset)) {
    return {};
  }
  return {
    "RateLimit-Policy": `"default";q=${limit};w=60`,
    "RateLimit": `"default";r=${remaining};t=${reset}`,
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(reset),
  };
}

/** Drops what the database adds for the handler's own use (`_sort`). */
function publicFields(item: unknown): unknown {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return item;
  }
  return Object.fromEntries(Object.entries(item).filter(([name]) => !name.startsWith("_")));
}

function canonical(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(Object.keys(value).sort().map((name) => [name, value[name] ?? null]));
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export function createApiHandler(deps: ApiDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const newRequestId = deps.newRequestId ?? (() => crypto.randomUUID());
  const logError = deps.logError ?? ((line: string) => console.error(line));
  const defer = deps.defer ?? ((work: Promise<unknown>) => void work.catch(() => undefined));

  async function call(route: Route | null, fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await deps.rpc(fn, args);
    if (error !== null) {
      const problem = problemFromDatabase(error);
      if (problem !== null) {
        throw problem;
      }
      logError(`api ${route?.operationId ?? fn}: ${fn} failed with ${error.code ?? "no code"}`);
      throw new ApiProblem("internal");
    }
    return data;
  }

  /** The gate: who is calling, and may they call now. Its counters commit on their own. */
  async function passGate(digest: string | null, ipHash: string | null): Promise<Record<string, unknown>> {
    const gate = await call(null, "api_gate", { p_digest: digest, p_ip_hash: ipHash });
    if (typeof gate !== "object" || gate === null) {
      logError("api: api_gate answered no object");
      throw new ApiProblem("internal");
    }
    const record = gate as Record<string, unknown>;
    if (record.ok === true) {
      if (digest === null || typeof record.digest !== "string" || !timingSafeEqual(record.digest, digest)) {
        throw new ApiProblem("invalid-key", {}, { "WWW-Authenticate": 'Bearer realm="woom"' });
      }
      return record;
    }
    const code = String(record.code);
    if (code === "rate-limited") {
      throw new ApiProblem("rate-limited", {}, {
        "Retry-After": String(Number(record.retry_after) || 60),
        ...rateHeaders(record),
      });
    }
    if (AUTH_CODES.has(code)) {
      // RFC 6750 §3.1: no error code when no credentials were sent.
      throw new ApiProblem(code as ProblemCode, {}, {
        "WWW-Authenticate": code === "missing-key" ? 'Bearer realm="woom"' : 'Bearer realm="woom", error="invalid_token"',
      });
    }
    logError(`api: api_gate answered an unknown code`);
    throw new ApiProblem("internal");
  }

  async function list(route: Route, url: URL, args: Record<string, unknown>, filters: Record<string, unknown>): Promise<Answer> {
    if (route.cursor === undefined) {
      const items = await call(route, route.fn, args);
      if (!Array.isArray(items)) {
        throw new ApiProblem("internal");
      }
      return { status: 200, body: { data: items.map(publicFields), next_cursor: null } };
    }

    const rawLimit = url.searchParams.get("limit");
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== null) {
      const parsed = checkScalar("limit", rawLimit);
      if (!parsed.ok) {
        throw new ApiProblem("invalid-request", { errors: [{ name: "limit", message: parsed.message }] });
      }
      limit = parsed.value as number;
    }
    const fingerprint = await filterFingerprint({ operation: route.operationId, ...filters });
    const rawCursor = url.searchParams.get("cursor");
    if (rawCursor !== null) {
      const key = decodeCursor(rawCursor, fingerprint);
      const first = key === null ? null : checkScalar(route.cursor.kinds[0], String(key[0]));
      const second = key === null ? null : checkScalar(route.cursor.kinds[1], String(key[1]));
      if (first === null || second === null || !first.ok || !second.ok) {
        throw new ApiProblem("invalid-cursor");
      }
      args[route.cursor.args[0]] = first.value;
      args[route.cursor.args[1]] = second.value;
    }
    args.p_limit = limit;

    const items = await call(route, route.fn, args);
    if (!Array.isArray(items)) {
      throw new ApiProblem("internal");
    }
    const page = items.slice(0, limit) as Record<string, unknown>[];
    let next: string | null = null;
    if (items.length > limit && page.length > 0) {
      const key = route.cursor.keyOf(page[page.length - 1]);
      if (key === null) {
        logError(`api ${route.operationId}: an item has no sort key`);
        throw new ApiProblem("internal");
      }
      next = encodeCursor(key, fingerprint);
    }
    return { status: 200, body: { data: page.map(publicFields), next_cursor: next } };
  }

  async function write(
    route: Route,
    request: Request,
    pathValues: Readonly<Record<string, string>>,
    args: Record<string, unknown>,
  ): Promise<Answer> {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!/^application\/json(\s*;.*)?$/i.test(contentType.trim())) {
      throw new ApiProblem("unsupported-media-type");
    }
    // Refused before it is read when it says its size; checked again after.
    const declared = Number(request.headers.get("Content-Length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      throw new ApiProblem("payload-too-large");
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      throw new ApiProblem("payload-too-large");
    }
    let body: unknown;
    try {
      body = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      throw new ApiProblem("invalid-request", { errors: [{ name: "body", message: "is not valid JSON" }] });
    }
    const parsed = parseBody(route.body ?? [], body);
    if (parsed.errors.length > 0) {
      throw new ApiProblem("invalid-request", { errors: parsed.errors });
    }

    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey === null) {
      throw new ApiProblem("idempotency-key-required");
    }
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new ApiProblem("invalid-request", {
        errors: [{ name: "Idempotency-Key", message: "must be 1 to 255 visible ASCII characters" }],
      });
    }
    const requestHash = await sha256Hex(`${route.operationId}\n${canonical(pathValues)}\n${canonical(parsed.values)}`);

    const answer = await call(route, route.fn, {
      ...args,
      ...parsed.args,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
    });
    const record = (typeof answer === "object" && answer !== null ? answer : {}) as Record<string, unknown>;
    const status = Number(record.status);
    const data = record.body;
    if (!Number.isInteger(status) || typeof data !== "object" || data === null) {
      logError(`api ${route.operationId}: the write answered no status or body`);
      throw new ApiProblem("internal");
    }
    return {
      status,
      body: { data: publicFields(data) },
      headers: record.replayed === true ? { "Idempotent-Replayed": "true" } : {},
      objectId: route.objectIdOf?.(data as Record<string, unknown>) ?? null,
    };
  }

  async function run(route: Route, pathValues: Readonly<Record<string, string>>, url: URL, request: Request, digest: string): Promise<Answer> {
    const reserved = route.cursor === undefined ? [] : ["cursor", "limit"];
    const query = parseQuery(route.params, pathValues, url.searchParams, reserved);
    if (query.errors.length > 0) {
      throw new ApiProblem("invalid-request", { errors: query.errors });
    }
    const from = query.values.date_from;
    const to = query.values.date_to;
    if (typeof from === "string" && typeof to === "string") {
      const span = daysBetween(from, to);
      if (span < 0 || span > MAX_DATE_SPAN_DAYS) {
        throw new ApiProblem("invalid-request", {
          errors: [{ name: "date_to", message: `must be on or after date_from, at most ${MAX_DATE_SPAN_DAYS} days later` }],
        });
      }
    }
    const args: Record<string, unknown> = { p_digest: digest, ...query.args };

    switch (route.kind) {
      case "list":
        return list(route, url, args, query.values);
      case "item":
        return { status: 200, body: { data: publicFields(await call(route, route.fn, args)) } };
      case "write":
        return write(route, request, pathValues, args);
    }
  }

  return async function handle(request: Request): Promise<Response> {
    const started = now();
    const requestId = newRequestId();
    if (request.method === "OPTIONS") {
      return respond(204, null, "text/plain", { "X-Request-Id": requestId });
    }

    let keyId: string | null = null;
    let operation = "unknown";
    let status = 500;
    let objectId: string | null = null;
    let rate: Record<string, string> = {};

    try {
      const url = new URL(request.url);
      if (KEY_PARAMS.some((name) => url.searchParams.has(name))) {
        throw new ApiProblem("key-in-url");
      }
      if (deps.pepper === null) {
        logError("api: API_KEY_PEPPER is missing or shorter than 32 characters");
        throw new ApiProblem("internal");
      }

      const token = readBearer(request);
      const digest = token === null
        ? null
        : await hmacHex(deps.pepper, token.length > MAX_TOKEN_LENGTH ? "woom_too_long" : token);
      const ip = clientIp(request);
      const ipHash = ip === null ? null : await hmacHex(deps.pepper, `ip:${ip}`);

      const gate = await passGate(digest, ipHash);
      keyId = typeof gate.key_id === "string" ? gate.key_id : null;
      rate = rateHeaders(gate);

      let found: ReturnType<typeof matchRoute>;
      try {
        found = matchRoute(request.method, stripPrefix(url.pathname));
      } catch {
        throw new ApiProblem("not-found");
      }
      if (found.match === null) {
        throw found.allowed.length > 0
          ? new ApiProblem("method-not-allowed", {}, { Allow: [...new Set(found.allowed)].join(", ") })
          : new ApiProblem("not-found", { detail: "No operation at this path" });
      }
      operation = found.match.route.operationId;

      const answer = await run(found.match.route, found.match.pathValues, url, request, digest as string);
      status = answer.status;
      objectId = answer.objectId ?? null;
      return respond(answer.status, answer.body, "application/json; charset=utf-8", {
        ...rate,
        ...answer.headers,
        "X-Request-Id": requestId,
      });
    } catch (error) {
      const problem = error instanceof ApiProblem ? error : null;
      if (problem === null) {
        logError(`api ${operation}: ${error instanceof Error ? error.name : "unknown"} thrown`);
      }
      const answered = problem ?? new ApiProblem("internal");
      status = answered.status;
      return respond(answered.status, answered.body(requestId), PROBLEM_CONTENT_TYPE, {
        ...rate,
        ...answered.headers,
        "X-Request-Id": requestId,
      });
    } finally {
      if (keyId !== null && LOGGED_METHODS.has(request.method)) {
        defer(
          Promise.resolve(deps.rpc("api_log_request", {
            p_key_id: keyId,
            p_operation: operation,
            p_method: request.method,
            p_status: status,
            p_duration_ms: Math.max(0, Math.round(now() - started)),
            p_object_id: objectId,
            p_request_id: requestId,
          })),
        );
      }
    }
  };
}
