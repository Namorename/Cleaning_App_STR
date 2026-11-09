/**
 * Where the consent page sends the admin's browser back (docs/mcp-oauth.md).
 *
 * The same rule as the database's oauth_redirect_allowed: a redirect the
 * client declared, exactly — or, for a program on this computer, the same
 * loopback address on any port (RFC 8252 §7.3): Claude Code listens on a port
 * that changes every session.
 */

const LOOPBACK = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/|$)/;
const LOOPBACK_PORT = /^(http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])):\d{1,5}/;

export function isLoopback(uri: string): boolean {
  return LOOPBACK.test(uri);
}

export function isRedirectAllowed(registered: readonly string[], redirect: string): boolean {
  if (registered.includes(redirect)) {
    return true;
  }
  if (!isLoopback(redirect)) {
    return false;
  }
  const bare = redirect.replace(LOOPBACK_PORT, '$1');
  return registered.some((uri) => uri.replace(LOOPBACK_PORT, '$1') === bare);
}

/** The client's redirect with the answer's parameters added (RFC 6749 §4.1.2, RFC 9207 `iss`). */
export function redirectBack(
  redirectUri: string,
  params: Readonly<Record<string, string | null>>,
): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    if (value !== null) {
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
}

/** What the page shows of where the browser goes back: a host, or a program's own scheme. */
export function redirectLabel(redirectUri: string): string {
  const url = new URL(redirectUri);
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    return url.host;
  }
  return url.host === '' ? url.protocol : `${url.protocol}//${url.host}`;
}
