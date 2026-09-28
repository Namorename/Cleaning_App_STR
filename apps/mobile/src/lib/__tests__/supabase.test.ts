import { createClient } from '@supabase/supabase-js';

import { env } from '../env';
import { SESSION_STORAGE_KEY, supabase } from '../supabase';

/**
 * The session's storage key is named so sign-out can look at what is stored.
 * It must be the very key auth-js would choose on its own: a different one
 * would sign out every phone that takes the update, the session sitting under
 * the old name.
 */

type WithStorageKey = { storageKey: string };

test('the named key is the one auth-js chooses by itself, so no phone loses its session', () => {
  const unnamed = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  expect((unnamed as unknown as WithStorageKey).storageKey).toBe(SESSION_STORAGE_KEY);
  expect((supabase as unknown as WithStorageKey).storageKey).toBe(SESSION_STORAGE_KEY);
});
