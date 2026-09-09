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
