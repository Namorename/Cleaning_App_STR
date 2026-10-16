import type { User } from '@supabase/supabase-js';

/** The roles the panel is for. Read from `app_metadata`, never `user_metadata`. */
export const PANEL_ROLES = ['manager', 'admin'] as const;
export type PanelRole = (typeof PANEL_ROLES)[number];

/**
 * The role a signed-in user carries, or null when the token has none.
 *
 * `app_metadata` is written by the server only; `user_metadata` is filled by
 * the client at sign-up and must never decide access.
 */
export function roleOf(user: Pick<User, 'app_metadata'> | null): string | null {
  const role = user?.app_metadata?.role;
  return typeof role === 'string' ? role : null;
}

export function isPanelRole(role: string | null): role is PanelRole {
  return role !== null && (PANEL_ROLES as readonly string[]).includes(role);
}

/**
 * How much of the panel a person reaches: all of it for the office, the
 * knowledge base alone for the head technician (the owner's decision of
 * 2026-10-17 — he writes and publishes it), nothing for anybody else. Row
 * level security decides what each may read and write either way.
 */
export type PanelAccess = 'full' | 'knowledge';

export function panelAccessOf(role: string | null): PanelAccess | null {
  if (isPanelRole(role)) {
    return 'full';
  }
  return role === 'head_tech' ? 'knowledge' : null;
}

/** The pages of a knowledge-only access: the section and the person's own settings. */
const KNOWLEDGE_PATHS = ['/knowledge', '/settings'];

/** Whether a page is one this access reaches. Paths only: the query is the page's. */
export function isPathOpenTo(access: PanelAccess, pathname: string): boolean {
  return (
    access === 'full' ||
    KNOWLEDGE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}

/** Where an access lands: after the sign-in, and from a page it does not reach. */
export function homeOf(access: PanelAccess): string {
  return access === 'full' ? '/dashboard' : '/knowledge';
}
