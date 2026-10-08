import { yearCookie } from './cookie';

/**
 * The menu's width (the owner's shell, variant A of docs/design/decisions.md
 * §2): the full menu, or folded to a strip of icons.
 *
 * A cookie, like the theme (`lib/theme.ts`), and not localStorage: the panel's
 * layout reads it on the server and draws the menu at the width the manager
 * left it at. Storage is read only once the page runs in the browser, so every
 * page would first paint the full menu and then jump to the strip. Free of any
 * React binding: the layout, a server component, imports it.
 */
export const SIDEBAR_COOKIE = 'sidebar';

export const SIDEBAR_STATES = ['expanded', 'collapsed'] as const;
export type SidebarState = (typeof SIDEBAR_STATES)[number];

export const DEFAULT_SIDEBAR_STATE: SidebarState = 'expanded';

export function sidebarFromCookie(value: string | undefined): SidebarState {
  return value === 'collapsed' ? 'collapsed' : DEFAULT_SIDEBAR_STATE;
}

export function sidebarCookie(state: SidebarState, isSecure: boolean): string {
  return yearCookie(SIDEBAR_COOKIE, state, isSecure);
}

/** The choice for the next page: the request carries it to the layout. */
export function rememberSidebar(doc: Document, state: SidebarState): void {
  doc.cookie = sidebarCookie(state, doc.location?.protocol === 'https:');
}
