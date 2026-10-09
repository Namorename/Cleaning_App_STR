import type { QueryClient } from '@tanstack/react-query';

import { forgetListsOfSignedOut } from '@/lib/query-client';
import { reportError } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';

/**
 * Whoever signs out takes their lists with them (`forgetListsOfSignedOut`):
 * from the button in the settings, or because auth let the session go — an
 * account switched off, a refresh refused. Listens for the rest of the app's
 * run; returns the unsubscribe. The moves waiting for signal stay.
 */
export function forgetListsOnSignOut(queryClient: QueryClient): () => void {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      forgetListsOfSignedOut(queryClient).catch(reportError);
    }
  });
  return () => data.subscription.unsubscribe();
}
