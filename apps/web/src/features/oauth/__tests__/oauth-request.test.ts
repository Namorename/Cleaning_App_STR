import { describe, expect, test, vi } from 'vitest';

import { readAuthorizeRequest, type AuthorizeDeps, type SearchParams } from '../authorize-request';
import {
  fetchClientMetadata,
  isClientIdUrl,
  KNOWN_CLIENTS,
  type OAuthClient,
} from '../client-metadata';
import { authorizationServerMetadata, mcpResource, oauthIssuer } from '../metadata';
import { isRedirectAllowed, isSafeRedirectUri, redirectBack, redirectLabel } from '../redirect';

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
        isVerified: true,
        clientHost: null,
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
      verified: false,
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

  test('the issuer is fixed, never read from the request; a stand may move it', () => {
    expect(oauthIssuer({})).toBe(ISSUER);
    expect(oauthIssuer({ OAUTH_ISSUER: 'http://127.0.0.1:8097/' })).toBe('http://127.0.0.1:8097');
  });
});

// docs/mcp-oauth.md: the security review of 10.11 — a client's own document is not to be trusted.
describe('a program woom cannot vouch for', () => {
  const EVIL = 'https://evil.example/c.json';
  const evil = (redirectUris: string[], name = 'Claude'): AuthorizeDeps => ({
    ...deps,
    lookupClient: (clientId) =>
      Promise.resolve<OAuthClient | null>(
        clientId === EVIL ? { id: EVIL, name, redirectUris, verified: false } : null,
      ),
  });

  test('may never send the browser to javascript:, whatever its document declares', async () => {
    const payload = 'javascript:location=1//';
    expect(
      await readAuthorizeRequest(
        params({ client_id: EVIL, redirect_uri: payload }),
        evil([payload]),
      ),
    ).toEqual({ kind: 'invalid', reason: 'badRedirect' });
    expect(() => redirectBack(payload, { error: 'access_denied', state: null })).toThrow();
  });

  test('gets its errors shown, not sent back: the panel is no open redirect', async () => {
    const outcome = await readAuthorizeRequest(
      params({
        client_id: EVIL,
        redirect_uri: 'https://phish.example/relogin',
        response_type: 'token',
      }),
      evil(['https://phish.example/relogin']),
    );
    expect(outcome).toEqual({ kind: 'invalid', reason: 'badRequest' });
  });

  test('is shown as unverified, with where its description lives', async () => {
    const outcome = await readAuthorizeRequest(
      params({ client_id: EVIL, redirect_uri: 'https://evil.example/cb' }),
      evil(['https://evil.example/cb']),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.request.isVerified).toBe(false);
      expect(outcome.request.clientHost).toBe('evil.example');
    }
  });

  test('its document drops a redirect a browser would run, and loses its hidden characters', async () => {
    const override = String.fromCharCode(0x202e);
    const body = {
      client_id: 'https://tool.example/oauth/client',
      client_name: `Cla${override}ude`,
      redirect_uris: ['javascript:alert(1)', 'https://tool.example/cb'],
    };
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body))));
    expect(await fetchClientMetadata(body.client_id, fetchImpl as unknown as typeof fetch)).toEqual(
      {
        id: body.client_id,
        name: 'Claude',
        redirectUris: ['https://tool.example/cb'],
        verified: false,
      },
    );
  });

  test('a document at an IP, at localhost or on another port is not fetched at all', async () => {
    const fetchImpl = vi.fn();
    for (const url of [
      'https://10.0.0.1/meta',
      'https://[::1]/meta',
      'https://app.localhost/meta',
      'https://tool.example:8443/meta',
      'https://intranet/meta',
    ]) {
      expect(isClientIdUrl(url), url).toBe(false);
      expect(await fetchClientMetadata(url, fetchImpl as unknown as typeof fetch)).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('safe redirects: https, loopback http, a program own scheme', () => {
    for (const ok of [
      'https://claude.ai/api/mcp/auth_callback',
      'http://localhost:3118/callback',
      'cursor://anysphere.cursor-mcp/oauth/callback',
      'com.example.app:/cb',
    ]) {
      expect(isSafeRedirectUri(ok), ok).toBe(true);
    }
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'http://claude.ai/cb',
      'mailto:x@y.z',
      'https://u:p@claude.ai/cb',
      'https://claude.ai/cb#x',
      'vbscript:x',
      'JAVASCRIPT:alert(1)',
    ]) {
      expect(isSafeRedirectUri(bad), bad).toBe(false);
    }
  });
});

test('a document streamed past 16 KiB without a length is cut off, not read whole', async () => {
  const chunk = new TextEncoder().encode('x'.repeat(4096));
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1;
      if (sent > 64) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
  });
  const fetchImpl = vi.fn(() => Promise.resolve(new Response(body)));
  expect(
    await fetchClientMetadata(
      'https://tool.example/oauth/client',
      fetchImpl as unknown as typeof fetch,
    ),
  ).toBeNull();
  expect(sent).toBeLessThan(10);
});
