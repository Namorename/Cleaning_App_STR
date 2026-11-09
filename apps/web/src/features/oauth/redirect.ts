/**
 * Where the consent page sends the admin's browser back (docs/mcp-oauth.md).
 *
 * Two rules, each held three times — here, in the Edge Function oauth, and in
 * the database (oauth_redirect_safe, oauth_redirect_allowed):
 *   * safe: a browser is only ever sent to https, to plain http on this
 *     computer, or to a program's own scheme — never to javascript:, data: or
 *     another scheme the browser would run or read itself, whatever a client's
 *     document declares;
 *   * allowed: a redirect the client declared, exactly — or, for a program on
 *     this computer, the same loopback address on any port (RFC 8252 §7.3):
 *     Claude Code listens on a port that changes every session.
 */

const HTTPS = /^https:\/\/[^/?:]+/;
const LOOPBACK = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/|$)/;
const LOOPBACK_PORT = /^(http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])):\d{1,5}/;
/** A program's own scheme (RFC 8252 §7.1): reverse-domain, or an editor's short one. */
const PROGRAM_SCHEME =
  /^(?:(?:cursor|vscode|vscode-insiders):\/\/|[a-z][a-z0-9+-]*(?:\.[a-z0-9+-]+)+:)/;
const CREDENTIALS = /^[a-z][a-z0-9+.-]*:\/\/[^/?]*@/;

export function isLoopback(uri: string): boolean {
  return LOOPBACK.test(uri);
}

export function isSafeRedirectUri(uri: string): boolean {
  if (uri.length === 0 || uri.length > 2048 || uri.includes('#') || CREDENTIALS.test(uri)) {
    return false;
  }
  try {
    new URL(uri);
  } catch {
    return false;
  }
  return HTTPS.test(uri) || LOOPBACK.test(uri) || PROGRAM_SCHEME.test(uri);
}

export function isRedirectAllowed(registered: readonly string[], redirect: string): boolean {
  if (!isSafeRedirectUri(redirect)) {
    return false;
  }
  if (registered.includes(redirect)) {
    return true;
  }
  if (!isLoopback(redirect)) {
    return false;
  }
  const bare = redirect.replace(LOOPBACK_PORT, '$1');
  return registered.some((uri) => uri.replace(LOOPBACK_PORT, '$1') === bare);
}

/**
 * The client's redirect with the answer's parameters added (RFC 6749 §4.1.2,
 * RFC 9207 `iss`). Throws on a redirect that is not safe: the page never builds
 * a way to one.
 */
export function redirectBack(
  redirectUri: string,
  params: Readonly<Record<string, string | null>>,
): string {
  if (!isSafeRedirectUri(redirectUri)) {
    throw new Error('Refusing to send the browser to an unsafe redirect');
  }
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
