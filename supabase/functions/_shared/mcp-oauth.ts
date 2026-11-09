/**
 * What the MCP server and the OAuth function share about sign-in
 * (docs/mcp-oauth.md): where the authorization server is (the panel), the MCP
 * server's canonical URL (the one resource tokens are issued for), and the
 * shapes of codes and tokens.
 *
 * A token, like a key, is 32 random bytes in base64url behind a prefix that
 * says what it is; the database keeps HMAC(pepper, token) only. A code is made
 * by the database (oauth_authorize) and kept there as its sha256.
 */

import type { EnvReader } from "./env.ts";

/** The panel: the authorization server's issuer, its metadata and its consent page. */
export const PANEL_URL = "https://woom-bnb.vercel.app";

/** The MCP server under a Supabase project. */
export const MCP_PATH = "/functions/v1/mcp";

/** Where the MCP server serves its Protected Resource Metadata (RFC 9728), under its own path. */
export const RESOURCE_METADATA_SUFFIX = "/.well-known/oauth-protected-resource";

export const ACCESS_TOKEN_PREFIX = "woomat_";
export const REFRESH_TOKEN_PREFIX = "woomrt_";
export const REFRESH_TOKEN_PATTERN = /^woomrt_[A-Za-z0-9_-]{43}$/;
export const CODE_PATTERN = /^woomcd_[0-9a-f]{64}$/;
/** RFC 7636 §4.1: 43 to 128 unreserved characters. */
export const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

export interface OAuthConfig {
  /** The authorization server's issuer, exactly as its metadata says it. */
  readonly issuer: string;
  /** The MCP server's canonical URL. */
  readonly resource: string;
}

/**
 * The issuer is the panel's production address; WOOM_PANEL_URL overrides it
 * for a stand. The resource follows the project's own URL.
 */
export function readOAuthConfig(env: EnvReader, supabaseUrl: string): OAuthConfig {
  const override = env.get("WOOM_PANEL_URL")?.trim() ?? "";
  return {
    issuer: (override === "" ? PANEL_URL : override).replace(/\/+$/, ""),
    resource: `${supabaseUrl.replace(/\/+$/, "")}${MCP_PATH}`,
  };
}

export function resourceMetadataUrl(resource: string): string {
  return `${resource}${RESOURCE_METADATA_SUFFIX}`;
}

/**
 * A URL as RFC 8707 compares it: scheme and host without case (the parser
 * lowers them), no trailing slash, no fragment or credentials. Null for
 * anything that is not an absolute URL of that kind.
 */
export function canonicalUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hash !== "" || url.username !== "" || url.password !== "") {
    return null;
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** A new token: the prefix and 32 bytes from the platform's CSPRNG. */
export function newToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}${base64url(bytes)}`;
}

/** The S256 challenge of a PKCE verifier (RFC 7636 §4.2). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
