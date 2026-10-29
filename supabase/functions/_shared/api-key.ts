/**
 * API keys of the public API (docs/api-v1.md §5.1), shared by the function
 * that issues them (api-keys) and the one that checks them (api).
 *
 * A key is `woom_` and 43 base64url characters of 32 random bytes. The
 * database keeps only HMAC-SHA256(pepper, key) in hex; the pepper is a secret
 * of the Edge Functions (API_KEY_PEPPER) and never reaches the database, so a
 * copy of the key table neither yields keys nor lets anyone test a guess.
 *
 * Nothing here logs: a key, a pepper or a digest never goes to a log line.
 */

export const API_KEY_PREFIX = "woom_";

const KEY_PATTERN = /^woom_[A-Za-z0-9_-]{43}$/;

/** How many characters of a key the panel shows to tell keys apart. */
export const DISPLAY_PREFIX_LENGTH = 12;

/** A pepper shorter than this is a deployment mistake, not a secret. */
export const MIN_PEPPER_LENGTH = 32;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A new key: 32 bytes from the platform's CSPRNG. */
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${API_KEY_PREFIX}${base64url(bytes)}`;
}

/** Does this look like one of our keys at all? Says nothing about whether it exists. */
export function looksLikeApiKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** The part of a key the panel may show: `woom_` and the first seven characters. */
export function displayPrefix(key: string): string {
  return key.slice(0, DISPLAY_PREFIX_LENGTH);
}

/** The pepper, or null when it is missing or too short to be one. */
export function readPepper(env: { get(key: string): string | undefined }): string | null {
  const value = env.get("API_KEY_PEPPER")?.trim() ?? "";
  return value.length >= MIN_PEPPER_LENGTH ? value : null;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function sha256Hex(message: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message)));
}

/** The digest the database keeps for a key. */
export function keyDigest(pepper: string, key: string): Promise<string> {
  return hmacHex(pepper, key);
}

/**
 * Equal strings, compared in time that depends on their length only.
 *
 * Both sides here are hex digests of the same length; a length mismatch is
 * answered at once, which tells an attacker nothing he did not send himself.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
