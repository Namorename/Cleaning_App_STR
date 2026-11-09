/**
 * The authorization server's metadata (RFC 8414), served by the panel at
 * /.well-known/oauth-authorization-server (docs/mcp-oauth.md).
 *
 * The panel is the issuer and holds the consent page; the token and
 * registration endpoints are the Edge Function oauth, where the pepper lives.
 * Public clients only, PKCE S256 always, and Claude's Client ID Metadata
 * Document is taken as its id — Claude chooses it over registration only when
 * both `client_id_metadata_document_supported` and the "none" method are here.
 */

/** The MCP server under the project: the one resource the panel signs clients in to. */
export function mcpResource(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/mcp`;
}

/** The consent page, under the issuer. */
export const AUTHORIZE_PATH = '/oauth/authorize';

export function oauthFunctionUrl(supabaseUrl: string, endpoint: 'token' | 'register'): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/oauth/${endpoint}`;
}

export function authorizationServerMetadata(
  issuer: string,
  supabaseUrl: string,
): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}${AUTHORIZE_PATH}`,
    token_endpoint: oauthFunctionUrl(supabaseUrl, 'token'),
    registration_endpoint: oauthFunctionUrl(supabaseUrl, 'register'),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/developers/mcp`,
  };
}

/** The panel's production address: the issuer the MCP server names (supabase/functions/_shared/mcp-oauth.ts). */
export const PANEL_ISSUER = 'https://woom-bnb.vercel.app';

/**
 * The issuer, fixed rather than read from the request: a forged Host header
 * must not make the metadata name another server. OAUTH_ISSUER (server-side
 * only) moves it for a stand; production needs nothing set.
 */
export function oauthIssuer(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env.OAUTH_ISSUER?.trim() ?? '';
  return (override === '' ? PANEL_ISSUER : override).replace(/\/+$/, '');
}
