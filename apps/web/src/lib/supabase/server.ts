import { createServerClient } from '@supabase/ssr';
import type { Database } from '@str-ops/shared';
import { cookies } from 'next/headers';

import { publicEnv } from '@/lib/env';

/**
 * A client for server components, route handlers and server actions.
 *
 * Reads the session from the request's cookies and writes refreshed tokens
 * back when it can. A server component cannot set cookies; that case is
 * expected and the proxy in `proxy.ts` refreshes the session instead.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a server component: cookies are read-only there.
        }
      },
    },
  });
}
