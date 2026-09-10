/** Where the panel sends a manager after sign-in when the request says nothing usable. */
export const DEFAULT_AFTER_SIGN_IN = '/dashboard';

/** A base that never matches a real origin; only used to parse relative paths. */
const LOCAL_BASE = 'http://panel.invalid';

/**
 * The `next` parameter, reduced to a path on this panel.
 *
 * Anything that resolves to another host is dropped: `//evil.com`,
 * `/\evil.com` (browsers read the backslash as a slash), `http://…`,
 * `javascript:`. The URL parser does the resolving, so the whole family of
 * look-alike prefixes is refused at once rather than one pattern at a time.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\')) {
    return DEFAULT_AFTER_SIGN_IN;
  }
  let url: URL;
  try {
    url = new URL(value, LOCAL_BASE);
  } catch {
    return DEFAULT_AFTER_SIGN_IN;
  }
  // The parser resolves "/a/..//evil.com" to the path "//evil.com", which a
  // browser would then read as protocol-relative: the origin check alone is
  // not enough, the resolved path must be a plain one as well.
  if (url.origin !== LOCAL_BASE || url.pathname.startsWith('//')) {
    return DEFAULT_AFTER_SIGN_IN;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
