/**
 * Opaque cursors (docs/api-v1.md §6.2).
 *
 * A cursor carries the sort key of the last item of a page and a fingerprint
 * of the filters it was made under. It is not signed: a forged cursor only
 * moves within the caller's own company, because the company comes from the
 * key. The fingerprint is there so that a cursor reused under other filters is
 * refused instead of silently skipping rows.
 */

import { sha256Hex } from "../_shared/api-key.ts";

export type CursorKey = readonly [string | number, string | number];

interface CursorPayload {
  readonly v: 1;
  readonly k: CursorKey;
  readonly f: string;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(text)) {
    return null;
  }
  try {
    const padded = text.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** The filters in a stable order, so the same set always hashes the same. */
export async function filterFingerprint(filters: Readonly<Record<string, unknown>>): Promise<string> {
  const ordered = Object.keys(filters).sort().map((name) => [name, filters[name] ?? null]);
  return (await sha256Hex(JSON.stringify(ordered))).slice(0, 16);
}

export function encodeCursor(key: CursorKey, fingerprint: string): string {
  const payload: CursorPayload = { v: 1, k: key, f: fingerprint };
  return toBase64Url(JSON.stringify(payload));
}

/** The sort key inside a cursor, or null when the cursor is not one of ours for these filters. */
export function decodeCursor(cursor: string, fingerprint: string): CursorKey | null {
  const text = fromBase64Url(cursor);
  if (text === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<CursorPayload>;
    if (parsed.v !== 1 || parsed.f !== fingerprint || !Array.isArray(parsed.k) || parsed.k.length !== 2) {
      return null;
    }
    const [first, second] = parsed.k;
    const scalar = (value: unknown) => typeof value === "string" || typeof value === "number";
    return scalar(first) && scalar(second) ? [first as string | number, second as string | number] : null;
  } catch {
    return null;
  }
}
