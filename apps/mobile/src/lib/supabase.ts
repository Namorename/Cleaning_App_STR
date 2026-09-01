import { createClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import { env } from '@/lib/env';
import { sessionStorage } from '@/lib/secure-storage';

/**
 * The app talks to Supabase as the signed-in cleaner, never as service_role.
 * Every row it can reach is decided by row level security, so the client
 * carries no authority of its own.
 */
export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    // There is no browser redirect flow here: sign-in is email and password.
    detectSessionInUrl: false,
  },
});
