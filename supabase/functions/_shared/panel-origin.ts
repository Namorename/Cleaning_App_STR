/**
 * The panel's pages, for the functions its browser calls with a session and that answer with what a
 * guest wrote (guest-review-text, guest-message-text). A request from any other page (its Origin) is
 * refused by them before anything is read, and no CORS header lets that page read an answer; a request
 * without an Origin is no page's (the phone, a script) and goes on to the token.
 *
 * The production address, the project's Vercel deployments (their nine-letter hash), a panel on this
 * machine (the local stands use several ports). A custom domain needs its line here — and both
 * functions redeployed, since each bundles its own copy of this file.
 */
const PANEL_ORIGINS: readonly RegExp[] = [
  /^https:\/\/woom-bnb\.vercel\.app$/,
  /^https:\/\/woom-[a-z0-9]{9}-namorename\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/,
];

export function isPanelOrigin(origin: string): boolean {
  return PANEL_ORIGINS.some((pattern) => pattern.test(origin));
}

/** CORS for one of the panel's pages: its own origin, never "*". */
export function panelCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
