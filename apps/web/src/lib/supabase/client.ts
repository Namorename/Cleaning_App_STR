import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@str-ops/shared';

import { publicEnv } from '@/lib/env';

import { staleClockSafeFetch } from './stale-clock-retry';

/**
 * The browser's client: one per page, reading the session from cookies. Its
 * requests go through `staleClockSafeFetch`: a read or a write PostgREST
 * refused for its own stale clock is sent again (stale-clock-retry.ts).
 */
export function createClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    global: { fetch: staleClockSafeFetch },
  });
}
