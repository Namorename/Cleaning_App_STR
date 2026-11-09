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

/**
 * The panel's own origin as the request reached it: the issuer must be the
 * address the client fetched the metadata from (RFC 8414 §3.3), whichever of
 * the deployment's addresses that was.
 */
export function requestOrigin(headers: Pick<Headers, 'get'>, fallback: string): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (host === null || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) {
    return fallback;
  }
  const proto = headers.get('x-forwarded-proto') === 'http' ? 'http' : 'https';
  return `${proto}://${host.toLowerCase()}`;
}
