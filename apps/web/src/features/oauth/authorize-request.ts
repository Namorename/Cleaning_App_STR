import type { OAuthClient } from './client-metadata';
import { isLoopback, isRedirectAllowed, redirectBack, redirectLabel } from './redirect';

/**
 * An authorization request (RFC 6749 §4.1.1, OAuth 2.1, MCP authorization),
 * read before the consent page shows anything (docs/mcp-oauth.md).
 *
 * Until the client and its redirect are known good, a problem is shown on the
 * page and the browser goes nowhere: redirecting to an unchecked address is an
 * open redirect (RFC 6749 §4.1.2.1). Only a verified client (Claude's own
 * documents) gets a problem back on its redirect, with the issuer (RFC 9207):
 * anyone can publish a document whose redirect is a page of their choosing,
 * and the panel's address must not send a browser there unasked.
 */

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

export interface ConsentRequest {
  readonly clientId: string;
  /** As the client names itself; null when it gives no name. */
  readonly clientName: string | null;
  /** One of Claude's own documents; any other client is shown as one woom cannot vouch for. */
  readonly isVerified: boolean;
  /** Where the client's document is published (a client named by a URL), or null. */
  readonly clientHost: string | null;
  readonly redirectUri: string;
  /** The host (or a program's scheme) the browser goes back to, for the page to show. */
  readonly redirectLabel: string;
  /** Back to a program on this computer: the page warns, as MCP asks. */
  readonly isLoopback: boolean;
  readonly codeChallenge: string;
  readonly resource: string;
  readonly state: string | null;
  readonly issuer: string;
}

export type AuthorizeOutcome =
  | { readonly kind: 'invalid'; readonly reason: 'badRequest' | 'unknownClient' | 'badRedirect' }
  | { readonly kind: 'redirect'; readonly to: string }
  | { readonly kind: 'ok'; readonly request: ConsentRequest };

export interface AuthorizeDeps {
  /** The panel's origin: the issuer. */
  readonly issuer: string;
  /** The MCP server's canonical URL: the one resource a code is for. */
  readonly resource: string;
  /** The client behind an id, from its document or its registration; null when unknown. */
  readonly lookupClient: (clientId: string) => Promise<OAuthClient | null>;
}

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const MAX_PARAM_LENGTH = 2048;

/** A parameter given once, or null; a repeated one is a malformed request (RFC 6749 §3.1). */
function single(params: SearchParams, name: string): string | null | undefined {
  const value = params[name];
  if (Array.isArray(value)) {
    return undefined;
  }
  return value === undefined || value === '' ? null : value;
}

/** As RFC 8707 compares: scheme and host without case, no trailing slash. */
export function canonicalUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hash !== '' || url.username !== '' || url.password !== '') {
    return null;
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`;
}

export async function readAuthorizeRequest(
  params: SearchParams,
  deps: AuthorizeDeps,
): Promise<AuthorizeOutcome> {
  const names = [
    'client_id',
    'redirect_uri',
    'response_type',
    'code_challenge',
    'code_challenge_method',
    'state',
    'resource',
  ];
  const values = Object.fromEntries(names.map((name) => [name, single(params, name)]));
  const clientId = values.client_id;
  const redirectUri = values.redirect_uri;
  if (
    typeof clientId !== 'string' ||
    typeof redirectUri !== 'string' ||
    clientId.length > MAX_PARAM_LENGTH ||
    redirectUri.length > MAX_PARAM_LENGTH
  ) {
    return { kind: 'invalid', reason: 'badRequest' };
  }

  const client = await deps.lookupClient(clientId);
  if (client === null) {
    return { kind: 'invalid', reason: 'unknownClient' };
  }
  if (!isRedirectAllowed(client.redirectUris, redirectUri)) {
    return { kind: 'invalid', reason: 'badRedirect' };
  }

  // From here the redirect is the client's own: a verified client's errors go back to it.
  const state = typeof values.state === 'string' ? values.state : null;
  const back = (error: string, description: string): AuthorizeOutcome =>
    client.verified
      ? {
          kind: 'redirect',
          to: redirectBack(redirectUri, {
            error,
            error_description: description,
            state,
            iss: deps.issuer,
          }),
        }
      : { kind: 'invalid', reason: 'badRequest' };
  if (Object.values(values).some((value) => value === undefined)) {
    return back('invalid_request', 'A parameter was sent more than once');
  }
  if (state !== null && state.length > MAX_PARAM_LENGTH) {
    return back('invalid_request', 'state is too long');
  }
  if (values.response_type !== 'code') {
    return back('unsupported_response_type', 'Only the authorization code flow is supported');
  }
  if (
    values.code_challenge_method !== 'S256' ||
    typeof values.code_challenge !== 'string' ||
    !CHALLENGE.test(values.code_challenge)
  ) {
    return back('invalid_request', 'PKCE with S256 is required');
  }
  const resource = canonicalUrl(deps.resource);
  if (
    resource === null ||
    (typeof values.resource === 'string' && canonicalUrl(values.resource) !== resource)
  ) {
    return back('invalid_target', 'This server signs in to the woom MCP server only');
  }

  return {
    kind: 'ok',
    request: {
      clientId,
      clientName: client.name,
      isVerified: client.verified,
      clientHost:
        client.verified || !clientId.startsWith('https://') ? null : new URL(clientId).host,
      redirectUri,
      redirectLabel: redirectLabel(redirectUri),
      isLoopback: isLoopback(redirectUri),
      codeChallenge: values.code_challenge,
      resource,
      state,
      issuer: deps.issuer,
    },
  };
}
