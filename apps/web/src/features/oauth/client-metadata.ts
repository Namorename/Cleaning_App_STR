import { z } from 'zod';

import { isSafeRedirectUri } from './redirect';

/**
 * Who an OAuth client is (docs/mcp-oauth.md): a client that names itself by
 * an https URL publishes its Client ID Metadata Document there
 * (draft-ietf-oauth-client-id-metadata-document) — Claude and Claude Code do.
 * The consent page reads it on the server, to show who asks and to check the
 * redirect against the ones the client declared; the database cannot fetch it.
 *
 * Anybody can publish a document that calls itself «Claude»: only the two
 * documents at Anthropic's own addresses make a client verified, and the page
 * shows every other one as a program it cannot vouch for.
 */

export interface OAuthClient {
  readonly id: string;
  /** As the client names itself, cleaned; for a verified client, its known name. */
  readonly name: string | null;
  readonly redirectUris: readonly string[];
  /** One of KNOWN_CLIENTS: its name and redirects are the publisher's own. */
  readonly verified: boolean;
}

const FETCH_TIMEOUT_MS = 5_000;
const MAX_DOCUMENT_BYTES = 16 * 1024;
const MAX_REDIRECT_URIS = 20;
const MAX_NAME_LENGTH = 100;
/** Control and format characters (bidi overrides among them): a name is shown to an admin. */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Claude's two documents as published (read 2026-11-09), for when the live one
 * cannot be read: the redirects are Anthropic's own, so a stale copy can only
 * refuse a new one, never let a stranger in.
 */
export const KNOWN_CLIENTS: Readonly<Record<string, OAuthClient>> = {
  'https://claude.ai/oauth/mcp-oauth-client-metadata': {
    id: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    name: 'Claude',
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    verified: true,
  },
  'https://claude.ai/oauth/claude-code-client-metadata': {
    id: 'https://claude.ai/oauth/claude-code-client-metadata',
    name: 'Claude Code',
    redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    verified: true,
  },
};

const documentSchema = z.object({
  client_id: z.string(),
  client_name: z
    .string()
    .max(MAX_NAME_LENGTH * 2)
    .optional(),
  redirect_uris: z.array(z.string().max(2048)).min(1).max(MAX_REDIRECT_URIS),
  token_endpoint_auth_method: z.string().optional(),
});

/** A name as the admin will read it: no control or bidi characters, at most 100 long. */
export function cleanClientName(value: string | null | undefined): string | null {
  const name = (value ?? '').replace(HIDDEN_CHARACTERS, '').trim();
  return name === '' ? null : name.slice(0, MAX_NAME_LENGTH);
}

/**
 * The draft's §3, and no more than a public web address: an https URL with a
 * path, on a named host with the default port — no IP literal, no localhost —
 * and nothing that would make two spellings of one client (fragment,
 * credentials, dot segments).
 */
export function isClientIdUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname;
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    host.includes('.') &&
    !IPV4.test(host) &&
    !host.startsWith('[') &&
    !host.endsWith('.localhost') &&
    url.pathname !== '/' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '' &&
    !/\/\.\.?(\/|$)/.test(value.replace(/^https:\/\/[^/]+/, ''))
  );
}

/** The body as text, read no further than the cap: a chunked answer has no length to trust. */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('Content-Length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
    return null;
  }
  if (response.body === null) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_DOCUMENT_BYTES) {
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

async function fetchLive(clientId: string, fetchImpl: typeof fetch): Promise<OAuthClient | null> {
  try {
    const response = await fetchImpl(clientId, {
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const text = await readCapped(response);
    const parsed = text === null ? null : documentSchema.safeParse(JSON.parse(text));
    if (!parsed?.success || parsed.data.client_id !== clientId) {
      return null;
    }
    // A public client: one that would sign its requests needs keys we do not read.
    const method = parsed.data.token_endpoint_auth_method;
    if (method !== undefined && method !== 'none') {
      return null;
    }
    // A redirect a browser must never be sent to is dropped: it can match nothing.
    const redirectUris = parsed.data.redirect_uris.filter(isSafeRedirectUri);
    if (redirectUris.length === 0) {
      return null;
    }
    const known = KNOWN_CLIENTS[clientId];
    return {
      id: clientId,
      name: known?.name ?? cleanClientName(parsed.data.client_name),
      redirectUris,
      verified: known !== undefined,
    };
  } catch {
    return null;
  }
}

/** The client behind a URL, or null when it cannot be read or is not one we serve. */
export async function fetchClientMetadata(
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthClient | null> {
  if (!isClientIdUrl(clientId)) {
    return null;
  }
  return (await fetchLive(clientId, fetchImpl)) ?? KNOWN_CLIENTS[clientId] ?? null;
}
