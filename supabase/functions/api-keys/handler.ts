/**
 * Issuing an API key, for the panel's «Settings → API» (docs/api-v1.md §2, §11).
 *
 * The key is made here because the pepper is here: the database keeps only
 * HMAC(pepper, key), and the pepper is a secret of the Edge Functions. The admin
 * calls with her own session token; this function checks the token, makes the
 * key, and asks the database to record it in her name (create_api_key, which
 * checks again that she is an active admin and validates the scopes against the
 * registry). The key goes back once, in this answer, and nowhere else.
 *
 * Listing, changing and revoking need no pepper: the panel calls those RPCs
 * directly, as the admin.
 *
 * Refusals use the panel's shape, `{error: {message, hint, details}}`, so
 * functionError() and serverErrorText() translate them like any other.
 */

import { displayPrefix, generateApiKey, keyDigest } from "../_shared/api-key.ts";

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The expiries the panel offers; null is «never». */
export const EXPIRY_DAYS: readonly (number | null)[] = [30, 90, 365, null];

const MAX_SCOPES = 64;
const MAX_PROPERTIES = 500;

export interface CreateKeyInput {
  readonly name: string;
  readonly preset: string;
  readonly scopes: readonly string[];
  readonly propertyIds: readonly number[] | null;
  readonly expiresInDays: number | null;
  readonly confirmation: string | null;
}

export interface CreateKeyRecord {
  readonly actorId: string;
  readonly name: string;
  readonly prefix: string;
  readonly digest: string;
  readonly preset: string;
  readonly scopes: readonly string[];
  readonly propertyIds: readonly number[] | null;
  readonly expiresAt: string | null;
  readonly confirmation: string | null;
}

/** What a failed database call says, as supabase-js hands it over. */
export interface DatabaseError {
  readonly message: string;
  readonly hint?: string | null;
  readonly details?: string | null;
}

export interface KeysDeps {
  /** The signed-in person behind a session token, or null when the token is not one. */
  readonly userIdOf: (token: string) => Promise<string | null>;
  /** create_api_key as service_role; the stored key as the panel sees it, or the refusal. */
  readonly createKey: (record: CreateKeyRecord) => Promise<{ data: unknown; error: DatabaseError | null }>;
  readonly pepper: string | null;
  readonly newKey?: () => string;
  readonly now?: () => number;
  readonly logError?: (line: string) => void;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function refusal(status: number, message: string, hint: string, details: string | null = null): Response {
  return json({ error: { message, hint, details } }, status);
}

function readBearer(request: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("Authorization") ?? "");
  return match === null ? null : match[1];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isIdArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && (item as number) > 0);
}

/** The form's fields, checked for shape; their meaning is the database's to judge. */
export function readInput(body: unknown): CreateKeyInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const { name, preset, scopes, property_ids, expires_in_days, confirmation } = record;
  if (typeof name !== "string" || typeof preset !== "string") {
    return null;
  }
  if (!isStringArray(scopes) || scopes.length > MAX_SCOPES) {
    return null;
  }
  if (property_ids !== null && (!isIdArray(property_ids) || property_ids.length > MAX_PROPERTIES)) {
    return null;
  }
  if (!EXPIRY_DAYS.includes(expires_in_days as number | null)) {
    return null;
  }
  if (confirmation !== undefined && confirmation !== null && typeof confirmation !== "string") {
    return null;
  }
  return {
    name,
    preset,
    scopes,
    propertyIds: property_ids as number[] | null,
    expiresInDays: expires_in_days as number | null,
    confirmation: (confirmation as string | null | undefined) ?? null,
  };
}

export function createKeysHandler(deps: KeysDeps): (request: Request) => Promise<Response> {
  const newKey = deps.newKey ?? generateApiKey;
  const now = deps.now ?? (() => Date.now());
  const logError = deps.logError ?? ((line: string) => console.error(line));

  return async function handle(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return refusal(405, "Only POST", "serverErrors.unknown");
    }
    if (deps.pepper === null) {
      logError("api-keys: API_KEY_PEPPER is missing or shorter than 32 characters");
      return refusal(500, "The function is not configured", "serverErrors.unknown");
    }

    const token = readBearer(request);
    const userId = token === null ? null : await deps.userIdOf(token);
    if (userId === null) {
      return refusal(401, "Sign in again", "serverErrors.adminOnly");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refusal(400, "The body is not JSON", "serverErrors.unknown");
    }
    const input = readInput(body);
    if (input === null) {
      return refusal(400, "The form is not complete", "serverErrors.unknown");
    }

    const key = newKey();
    const digest = await keyDigest(deps.pepper, key);
    const expiresAt = input.expiresInDays === null
      ? null
      : new Date(now() + input.expiresInDays * 86_400_000).toISOString();

    const { data, error } = await deps.createKey({
      actorId: userId,
      name: input.name,
      prefix: displayPrefix(key),
      digest,
      preset: input.preset,
      scopes: input.scopes,
      propertyIds: input.propertyIds,
      expiresAt,
      confirmation: input.confirmation,
    });
    if (error !== null) {
      const hint = error.hint ?? "";
      if (hint.startsWith("serverErrors.")) {
        return refusal(409, error.message, hint, error.details ?? null);
      }
      logError("api-keys: create_api_key failed");
      return refusal(500, "The key could not be saved", "serverErrors.unknown");
    }
    return json({ data: { key, api_key: data } }, 201);
  };
}
