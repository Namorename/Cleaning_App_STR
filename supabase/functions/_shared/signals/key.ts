/**
 * The keys a repeated load meets a signal by (the owner's decision of
 * 2026-10-18, P1 of docs/guest-signals.md §2.4): HMAC-SHA256, as lowercase
 * hex, under a secret of the functions —
 * - a signal: "<provider>:<kind>:<the PMS's id>", e.g. "hostaway:review:90000001";
 * - a conversation: "<provider>:conversation:<the PMS's id>".
 *
 * The PMS's id finds the booking through the PMS, so the database keeps it
 * only while the stay is exact. The key stays: a repeated load, a repeated
 * webhook and a hiding seen months later meet the same row, and without the
 * secret — which lives in the functions' secrets, never in the database or the
 * repository — the key leads to no signal and no booking.
 *
 * The secret is created once, by the owner, at rollout, and never changes:
 * under another secret every signal already loaded would come in again as a
 * new one.
 */

import { ConfigError, type EnvReader } from "../env.ts";
import type { Provider, SignalKind } from "./adapter.ts";

export const SIGNAL_KEY_SECRET_ENV = "GUEST_SIGNAL_KEY_SECRET";

/** 32 characters at least: a random 256-bit value written as text. */
export const MIN_SECRET_LENGTH = 32;

/** The key of one PMS id, 64 lowercase hexadecimal characters. */
export type SignalKeyer = (externalId: string) => Promise<string>;

/** The secret from the function's environment; the message never carries it. */
export function readSignalKeySecret(env: EnvReader): string {
  const value = env.get(SIGNAL_KEY_SECRET_ENV)?.trim() ?? "";
  if (value === "") {
    throw new ConfigError(`Missing environment variable: ${SIGNAL_KEY_SECRET_ENV}`);
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      `${SIGNAL_KEY_SECRET_ENV} is shorter than ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return value;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacKeyer(secret: string, prefix: string): Promise<SignalKeyer> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return async (externalId: string) => {
    if (externalId === "") {
      // Every signal without an id would share one key, and one row.
      throw new Error("A signal key needs the PMS's id");
    }
    return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${prefix}:${externalId}`)));
  };
}

/** guest_signals.external_key: HMAC of "<provider>:<kind>:<id>". */
export function createSignalKeyer(provider: Provider, kind: SignalKind, secret: string): Promise<SignalKeyer> {
  return hmacKeyer(secret, `${provider}:${kind}`);
}

/** guest_signals.conversation_key: HMAC of "<provider>:conversation:<id>". */
export function createConversationKeyer(provider: Provider, secret: string): Promise<SignalKeyer> {
  return hmacKeyer(secret, `${provider}:conversation`);
}
