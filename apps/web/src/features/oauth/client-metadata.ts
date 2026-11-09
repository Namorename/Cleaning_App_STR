import { z } from 'zod';

/**
 * Who an OAuth client is (docs/mcp-oauth.md): a client that names itself by
 * an https URL publishes its Client ID Metadata Document there
 * (draft-ietf-oauth-client-id-metadata-document) — Claude and Claude Code do.
 * The consent page reads it on the server, to show the client's name and to
 * check the redirect against the ones the client declared; the database
 * cannot fetch it.
 */

export interface OAuthClient {
  readonly id: string;
  readonly name: string | null;
  readonly redirectUris: readonly string[];
}

const FETCH_TIMEOUT_MS = 5_000;
const MAX_DOCUMENT_BYTES = 16 * 1024;
const MAX_REDIRECT_URIS = 20;

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
  },
  'https://claude.ai/oauth/claude-code-client-metadata': {
    id: 'https://claude.ai/oauth/claude-code-client-metadata',
    name: 'Claude Code',
    redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  },
};

const documentSchema = z.object({
  client_id: z.string(),
  client_name: z.string().max(100).optional(),
  redirect_uris: z.array(z.string().max(2048)).min(1).max(MAX_REDIRECT_URIS),
  token_endpoint_auth_method: z.string().optional(),
});

/**
 * The draft's §3: an https URL with a path, and nothing that would make two
 * spellings of one client — no fragment, credentials or dot segments.
 */
export function isClientIdUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.pathname !== '/' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '' &&
    !/\/\.\.?(\/|$)/.test(value.replace(/^https:\/\/[^/]+/, ''))
  );
}

/** The body as text, no further than the cap. */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('Content-Length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
    return null;
  }
  const text = await response.text();
  return text.length > MAX_DOCUMENT_BYTES ? null : text;
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
    return {
      id: clientId,
      name: parsed.data.client_name?.trim() || null,
      redirectUris: parsed.data.redirect_uris,
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
