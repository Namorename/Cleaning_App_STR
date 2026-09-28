import { createClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import { env } from '@/lib/env';
import { sessionStorage } from '@/lib/secure-storage';

/**
 * Where auth-js keeps the session: its own default, spelled out so that
 * sign-out can look at what is still stored (features/auth/session.tsx). The
 * same value as before it was named, so no signed-in phone loses its session.
 */
export const SESSION_STORAGE_KEY = `sb-${new URL(env.supabaseUrl).hostname.split('.')[0]}-auth-token`;

/**
 * The app talks to Supabase as the signed-in cleaner, never as service_role.
 * Every row it can reach is decided by row level security, so the client
 * carries no authority of its own.
 */
export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    storage: sessionStorage,
    storageKey: SESSION_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    // There is no browser redirect flow here: sign-in is email and password.
    detectSessionInUrl: false,
  },
});
