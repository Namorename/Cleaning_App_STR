import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';

import { letGoAfterSessionEnded } from '@/features/push/pending-release';
import { adoptMovesWithoutAuthor, noteSignedIn } from '@/lib/move-queue';
import { settleQueueFor } from '@/lib/parked-moves';
import { QUERY_CACHE_KEY, forgetSavedListsOfSignedOut } from '@/lib/query-client';
import { reportError } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';

/** Whose lists the cache on disk holds: the id of the last person whose session the app knew. */
export const CACHE_OWNER_KEY = `${QUERY_CACHE_KEY}.owner`;

/**
 * The most the screens wait, once the cache is back, for its lists to be
 * checked against whose they are. The check is a read of the stamp and work
 * in memory, done in an instant; a stamp that never comes back must not keep
 * the screens from drawing.
 */
export const OWNER_CHECK_WAIT_MS = 2_000;

/** The cache's restore, as the root sees it through. */
export interface RestoreGate {
  /** Settles once the cache on disk is back in memory, or found unreadable. */
  done: Promise<void>;
  open: () => void;
  /**
   * Settles once the lists brought back have been checked against whose they
   * are (`forgetListsOnSignOut`) — or OWNER_CHECK_WAIT_MS after `open`, should
   * the check not come.
   */
  checked: Promise<void>;
  markChecked: () => void;
}

export function createRestoreGate(): RestoreGate {
  let openDone: () => void = () => undefined;
  let settleChecked: () => void = () => undefined;
  let wait: ReturnType<typeof setTimeout> | undefined;
  let isChecked = false;
  const done = new Promise<void>((resolve) => {
    openDone = resolve;
  });
  const checked = new Promise<void>((resolve) => {
    settleChecked = resolve;
  });
  const markChecked = (): void => {
    isChecked = true;
    clearTimeout(wait);
    settleChecked();
  };
  const open = (): void => {
    openDone();
    if (!isChecked && wait === undefined) {
      wait = setTimeout(markChecked, OWNER_CHECK_WAIT_MS);
    }
  };
  return { done, open, checked, markChecked };
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
 * refused.
 *
 * And the queue of moves belongs to its author (owner's decision of
 * 2026-10-09; lib/move-queue.ts, lib/parked-moves.ts). Every event tells the
 * queue at once who is signed in (`noteSignedIn`): a move runs only with its
 * author's session. On a sign-out, and once the first session after the
 * restore is known and at every change of person after it, the queue is
 * sorted for the person now signed in (`settleQueueFor`): everybody else's
 * moves parked on disk, hers back from it, then hers resumed — also for the
 * same person signing in again, whose stamp is already on the cache. A start
 * that knows no session sorts nothing and resumes nothing. A move saved by a
 * build before moves had authors is the stamp's person's; with no stamp, the
 * first person's signed in after the restore.
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
 * from what it brought: `onChecked` is called once the stamp is read and
 * every event heard so far is handled in memory, and the root holds the
 * screens until then (`RestoreGate.checked`). After that, an event is handled
 * at once, in memory, while auth is still telling the screens: the next
 * person's first screen never draws the last one's lists. The disk follows in
 * the order the events came; a stamp is written only once the lists are off
 * the disk, so a wipe the disk refused leaves the stamp it had, and the next
 * start forgets them again. The queue is sorted in the same order, each time
 * after the lists of the same event. Listens for the rest of the app's run;
 * returns the unsubscribe.
 */
export function forgetListsOnSignOut(
  queryClient: QueryClient,
  restored: Promise<void>,
  onChecked: () => void = () => undefined,
): () => void {
  // Whose lists the cache holds; undefined until the restore is in and the stamp read.
  let owner: string | null | undefined;
  // Events that came before then, still to be handled; later ones wait behind them.
  let waiting = 0;
  // Whom the queue was last sorted for; undefined until the first time after the restore.
  let queueOf: string | null | undefined;
  // Who takes the moves saved with no author: the stamp's person, else the first one signed in.
  let heir: string | null = null;

  const checkedIfCaughtUp = (): void => {
    if (owner !== undefined && waiting === 0) {
      onChecked();
    }
  };

  // The disk's work, one step after the other.
  let queue: Promise<void> = Promise.all([restored, readOwner()]).then(([, saved]) => {
    owner = saved;
    heir = saved;
    if (saved !== null) {
      adoptMovesWithoutAuthor(queryClient, saved);
    }
    checkedIfCaughtUp();
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
    queryClient.removeQueries();
    // One step: the stamp only once the lists are off the disk.
    later(async () => {
      await forgetSavedListsOfSignedOut();
      await AsyncStorage.setItem(CACHE_OWNER_KEY, userId);
    });
  };

  // The queue sorted for `person` on disk, in turn: once per change of person.
  const sortQueueFor = (person: string | null): void => {
    if (person === queueOf) {
      return;
    }
    queueOf = person;
    later(async () => {
      if (person !== null) {
        heir = heir ?? person;
        adoptMovesWithoutAuthor(queryClient, heir);
      }
      await settleQueueFor(queryClient, person);
    });
  };

  const inTurn = (step: () => void): void => {
    if (owner !== undefined && waiting === 0) {
      step();
      return;
    }
    waiting += 1;
    later(() => {
      waiting -= 1;
      try {
        step();
      } finally {
        checkedIfCaughtUp();
      }
    });
  };

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      // Whatever ended the session lets go of the phone's push token too
      // (owner's word of 2026-10-11, 00:40); the button does it itself.
      void letGoAfterSessionEnded();
      noteSignedIn(null);
      inTurn(() => {
        forgetLists();
        sortQueueFor(null);
      });
      return;
    }
    const userId = session?.user.id;
    noteSignedIn(userId ?? null);
    if (userId !== undefined) {
      inTurn(() => {
        claimFor(userId);
        sortQueueFor(userId);
      });
    }
  });
  return () => data.subscription.unsubscribe();
}
