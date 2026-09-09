import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@str-ops/shared';

import { publicEnv } from '@/lib/env';

/** The browser's client: one per page, reading the session from cookies. */
export function createClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey);
}
