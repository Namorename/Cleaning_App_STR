/** How long a choice is kept; the server sets the same age when it writes one (the sign-in). */
export const YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * A choice this browser keeps for the whole panel — the theme, the menu's
 * width — as `document.cookie` takes it: every path, for a year, sent with
 * the panel's own navigations. The server reads it before the first paint.
 */
export function yearCookie(name: string, value: string, isSecure: boolean): string {
  const cookie = `${name}=${value}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax`;
  return isSecure ? `${cookie}; Secure` : cookie;
}
