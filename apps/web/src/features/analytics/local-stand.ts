const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Whether the panel talks to a Supabase stack on this machine: only there may
 * the Analytics page count the demo listings in (owner, 2026-10-14).
 */
export function isLocalStand(supabaseUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(supabaseUrl).hostname);
  } catch {
    return false;
  }
}
