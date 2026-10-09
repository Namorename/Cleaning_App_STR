import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';

import { QUERY_CACHE_KEY, forgetSavedListsOfSignedOut } from '@/lib/query-client';
import { reportError } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';

/** Whose lists the cache on disk holds: the id of the last person whose session the app knew. */
export const CACHE_OWNER_KEY = `${QUERY_CACHE_KEY}.owner`;

/** Opened once the cache on disk is back in memory, or found unreadable. */
export interface RestoreGate {
  done: Promise<void>;
  open: () => void;
}

export function createRestoreGate(): RestoreGate {
  let open: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { done, open };
}

async function readOwner(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CACHE_OWNER_KEY);
  } catch (error: unknown) {
    // Unreadable is nobody's: the first session forgets the lists.
    reportError(error);
    return null;
  }
}

/**
 * Whoever signs out takes their lists with them, in memory and on disk
 * (`forgetSavedListsOfSignedOut`): from the button in the settings, or
 * because auth let the session go — an account switched off, a refresh
 * refused. The moves waiting for signal stay.
 *
 * auth-js may let a session go while it starts, before the root layout
 * listens (the verification review of f3217a7..c466bf5, item 2). So the cache
 * on disk carries a stamp of whose lists it holds (`CACHE_OWNER_KEY`), and
 * the first session known — signed in, or read at start — that is somebody
 * else's forgets them, in memory and on disk, before his first screen draws
 * them. A cache with no stamp is nobody's: written by a build before this
 * one, it may hold anyone's lists, and its first session forgets them too —
 * once, at the cost of a read. A start that knows no session forgets
 * nothing: offline with a token that expired, her lists are all she has.
 *
 * Nothing is forgotten before the cache is back from disk (`restored`): the
 * restore would bring the lists back. Until then each event waits its turn,
 * and is handled the moment the restore is in, before any screen is drawn
 * from what it brought. After that, an event is handled at once, in memory, while
 * auth is still telling the screens: the next person's first screen never
 * draws the last one's lists. The disk follows in the order the events came.
 * Listens for the rest of the app's run; returns the unsubscribe.
 */
export function forgetListsOnSignOut(
  queryClient: QueryClient,
  restored: Promise<void>,
): () => void {
  // Whose lists the cache holds; undefined until the restore is in and the stamp read.
  let owner: string | null | undefined;
  // Events that came before then, still to be handled; later ones wait behind them.
  let waiting = 0;
  // The disk's work, one step after the other.
  let queue: Promise<void> = Promise.all([restored, readOwner()]).then(([, saved]) => {
    owner = saved;
  });

  const later = (step: () => void | Promise<void>): void => {
    queue = queue.then(step).catch(reportError);
  };

  const forgetLists = (): void => {
    // In memory now; on disk in turn.
    queryClient.removeQueries();
    later(forgetSavedListsOfSignedOut);
  };

  const claimFor = (userId: string): void => {
    if (owner === userId) {
      return;
    }
    owner = userId;
    forgetLists();
    later(() => AsyncStorage.setItem(CACHE_OWNER_KEY, userId));
  };

  const inTurn = (step: () => void): void => {
    if (owner !== undefined && waiting === 0) {
      step();
      return;
    }
    waiting += 1;
    later(() => {
      waiting -= 1;
      step();
    });
  };

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      inTurn(forgetLists);
      return;
    }
    const userId = session?.user.id;
    if (userId !== undefined) {
      inTurn(() => claimFor(userId));
    }
  });
  return () => data.subscription.unsubscribe();
}
