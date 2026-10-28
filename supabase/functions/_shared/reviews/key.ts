/**
 * The key a repeated load meets a review by (the owner's decision of
 * 2026-10-18, docs/reviews-to-tasks.md §2.2): HMAC-SHA256 of
 * "<source>:<the PMS's id of the review>" under a secret of this function.
 *
 * The PMS's id finds the booking through the PMS, so the database keeps it
 * only while the stay is exact. The key stays: a repeated load and a hiding
 * seen months later meet the same row, and without the secret — which lives
 * in the function's secrets, never in the database or the repository — the
 * key leads to no review and no booking.
 *
 * The secret is created once, by the owner, at rollout, and never changes:
 * under another secret every review already loaded would come in again as a
 * new one (docs §10).
 */

import { ConfigError, type EnvReader } from "../env.ts";

export const REVIEW_ID_SECRET_ENV = "REVIEW_ID_HMAC_SECRET";

/** 32 characters at least: a random 256-bit value written as text. */
export const MIN_SECRET_LENGTH = 32;

/** The key of one PMS id, 64 lowercase hexadecimal characters. */
export type ReviewKeyer = (externalId: string) => Promise<string>;

/** The secret from the function's environment; the message never carries it. */
export function readReviewIdSecret(env: EnvReader): string {
  const value = env.get(REVIEW_ID_SECRET_ENV)?.trim() ?? "";
  if (value === "") {
    throw new ConfigError(`Missing environment variable: ${REVIEW_ID_SECRET_ENV}`);
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      `${REVIEW_ID_SECRET_ENV} is shorter than ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return value;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createReviewKeyer(source: string, secret: string): Promise<ReviewKeyer> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return async (externalId: string) =>
    hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${source}:${externalId}`)));
}
