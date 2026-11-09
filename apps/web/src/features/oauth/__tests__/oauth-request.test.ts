import { describe, expect, test, vi } from 'vitest';

import { readAuthorizeRequest, type AuthorizeDeps, type SearchParams } from '../authorize-request';
import { fetchClientMetadata, isClientIdUrl, KNOWN_CLIENTS } from '../client-metadata';
import { authorizationServerMetadata, mcpResource, requestOrigin } from '../metadata';
import { isRedirectAllowed, redirectBack, redirectLabel } from '../redirect';

const ISSUER = 'https://woom-bnb.vercel.app';
const MCP = 'https://project.supabase.co/functions/v1/mcp';
const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const deps: AuthorizeDeps = {
  issuer: ISSUER,
  resource: MCP,
  lookupClient: (clientId) => Promise.resolve(KNOWN_CLIENTS[clientId] ?? null),
};

function params(overrides: Record<string, string | string[] | undefined> = {}): SearchParams {
  return {
    response_type: 'code',
    client_id: CLAUDE,
    redirect_uri: CALLBACK,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'st-1',
    resource: MCP,
    ...overrides,
  };
}

function errorOf(to: string) {
  const url = new URL(to);
  return {
    target: `${url.origin}${url.pathname}`,
    error: url.searchParams.get('error'),
    state: url.searchParams.get('state'),
    iss: url.searchParams.get('iss'),
  };
}

describe('the authorization request', () => {
  test('Claude asking for the MCP server is shown to the admin', async () => {
    const outcome = await readAuthorizeRequest(params(), deps);
    expect(outcome).toEqual({
      kind: 'ok',
      request: {
        clientId: CLAUDE,
        clientName: 'Claude',
        redirectUri: CALLBACK,
        redirectLabel: 'claude.ai',
        isLoopback: false,
        codeChallenge: CHALLENGE,
        resource: MCP,
        state: 'st-1',
        issuer: ISSUER,
      },
    });
  });

  test('Claude Code comes back to this computer on any port, and the page warns', async () => {
    const outcome = await readAuthorizeRequest(
      params({
        client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
        redirect_uri: 'http://localhost:3118/callback',
      }),
      deps,
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.request.isLoopback).toBe(true);
      expect(outcome.request.redirectLabel).toBe('localhost:3118');
    }
  });

  test('an unknown client or a redirect it never declared is shown, never followed', async () => {
    expect(
      await readAuthorizeRequest(params({ client_id: 'https://evil.example/meta' }), deps),
    ).toEqual({
      kind: 'invalid',
      reason: 'unknownClient',
    });
    expect(
      await readAuthorizeRequest(params({ redirect_uri: 'https://evil.example/cb' }), deps),
    ).toEqual({
      kind: 'invalid',
      reason: 'badRedirect',
    });
    expect(await readAuthorizeRequest(params({ client_id: undefined }), deps)).toEqual({
      kind: 'invalid',
      reason: 'badRequest',
    });
    expect(
      await readAuthorizeRequest(params({ redirect_uri: [CALLBACK, CALLBACK] }), deps),
    ).toEqual({
      kind: 'invalid',
      reason: 'badRequest',
    });
  });

  test('once the redirect is the client own, a bad request goes back to it with the issuer', async () => {
    const cases: [Record<string, string | string[] | undefined>, string][] = [
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge_method: undefined }, 'invalid_request'],
      [{ code_challenge: 'short' }, 'invalid_request'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
      [{ state: ['a', 'b'] }, 'invalid_request'],
    ];
    for (const [overrides, error] of cases) {
      const outcome = await readAuthorizeRequest(params(overrides), deps);
      expect(outcome.kind, JSON.stringify(overrides)).toBe('redirect');
      if (outcome.kind === 'redirect') {
        const back = errorOf(outcome.to);
        expect(back.target).toBe(CALLBACK);
        expect(back.error).toBe(error);
        expect(back.iss).toBe(ISSUER);
      }
    }
  });

  test('the resource may differ in case and a trailing slash, or be absent', async () => {
    expect(
      (
        await readAuthorizeRequest(
          params({ resource: 'HTTPS://Project.Supabase.co/functions/v1/mcp/' }),
          deps,
        )
      ).kind,
    ).toBe('ok');
    expect((await readAuthorizeRequest(params({ resource: undefined }), deps)).kind).toBe('ok');
  });
});

describe('redirects', () => {
  test('exactly as declared, or a loopback one on another port', () => {
    expect(isRedirectAllowed([CALLBACK], CALLBACK)).toBe(true);
    expect(isRedirectAllowed([CALLBACK], `${CALLBACK}/x`)).toBe(false);
    expect(
      isRedirectAllowed(['http://127.0.0.1/callback'], 'http://127.0.0.1:53682/callback'),
    ).toBe(true);
    expect(
      isRedirectAllowed(['http://127.0.0.1/callback'], 'http://localhost:53682/callback'),
    ).toBe(false);
    expect(isRedirectAllowed(['http://localhost/callback'], 'http://localhost:1/other')).toBe(
      false,
    );
    expect(isRedirectAllowed(['https://claude.ai/cb'], 'https://claude.ai:8443/cb')).toBe(false);
  });

  test('the answer is added to the redirect, keeping what it carried', () => {
    const to = redirectBack('http://127.0.0.1:5000/cb?x=1', {
      code: 'c',
      state: null,
      iss: ISSUER,
    });
    expect(to).toBe('http://127.0.0.1:5000/cb?x=1&code=c&iss=https%3A%2F%2Fwoom-bnb.vercel.app');
  });

  test('the page names a host, or a program own scheme', () => {
    expect(redirectLabel(CALLBACK)).toBe('claude.ai');
    expect(redirectLabel('cursor://anysphere.cursor-mcp/oauth/callback')).toBe(
      'cursor://anysphere.cursor-mcp',
    );
  });
});

describe('the client document', () => {
  const document = {
    client_id: 'https://tool.example/oauth/client',
    client_name: 'Tool',
    redirect_uris: ['https://tool.example/cb'],
    token_endpoint_auth_method: 'none',
  };

  function serving(body: unknown, init: ResponseInit = {}) {
    return vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200, ...init })),
    );
  }

  test('is read from its URL, without following a redirect', async () => {
    const fetchImpl = serving(document);
    const client = await fetchClientMetadata(
      document.client_id,
      fetchImpl as unknown as typeof fetch,
    );
    expect(client).toEqual({
      id: document.client_id,
      name: 'Tool',
      redirectUris: ['https://tool.example/cb'],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      document.client_id,
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  test('that names another client, signs its requests or is too large is refused', async () => {
    for (const body of [
      { ...document, client_id: 'https://tool.example/other' },
      { ...document, token_endpoint_auth_method: 'private_key_jwt' },
      { ...document, redirect_uris: [] },
      { ...document, client_name: 'x'.repeat(20_000) },
    ]) {
      expect(
        await fetchClientMetadata(document.client_id, serving(body) as unknown as typeof fetch),
      ).toBeNull();
    }
  });

  test('Claude is still known when its document cannot be read', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('offline')));
    expect(await fetchClientMetadata(CLAUDE, failing as unknown as typeof fetch)).toEqual(
      KNOWN_CLIENTS[CLAUDE],
    );
  });

  test('only an https URL with a path names a client', () => {
    expect(isClientIdUrl(CLAUDE)).toBe(true);
    for (const bad of [
      'http://claude.ai/meta',
      'https://claude.ai/',
      'https://claude.ai/a/../b',
      'https://u:p@x.example/m',
      'woomc_x',
    ]) {
      expect(isClientIdUrl(bad), bad).toBe(false);
    }
  });
});

describe('the authorization server metadata', () => {
  test('says where to sign in, where tokens come from, and that Claude may name itself by URL', () => {
    expect(authorizationServerMetadata(ISSUER, 'https://project.supabase.co/')).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: 'https://project.supabase.co/functions/v1/oauth/token',
      registration_endpoint: 'https://project.supabase.co/functions/v1/oauth/register',
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${ISSUER}/developers/mcp`,
    });
    expect(mcpResource('https://project.supabase.co/')).toBe(MCP);
  });

  test('the issuer is the address the request came to', () => {
    const headers = new Headers({ host: 'woom-bnb.vercel.app', 'x-forwarded-proto': 'https' });
    expect(requestOrigin(headers, 'https://fallback.example')).toBe(ISSUER);
    expect(
      requestOrigin(new Headers({ host: '127.0.0.1:8096', 'x-forwarded-proto': 'http' }), 'x'),
    ).toBe('http://127.0.0.1:8096');
    expect(
      requestOrigin(new Headers({ host: 'evil.example/path' }), 'https://fallback.example'),
    ).toBe('https://fallback.example');
  });
});
