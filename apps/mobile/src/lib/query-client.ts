import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, notifyManager, onlineManager, type QueryKey } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

import { registerChatMutations } from '@/features/chat/use-chat';
import { mediaKeys } from '@/features/media/keys';
import { isVideoUpload, registerMediaMutations } from '@/features/media/use-media';
import { registerProblemMutations } from '@/features/problems/use-problems';
import { registerSettingsMutations } from '@/features/settings/use-settings';
import { stepKeys } from '@/features/steps/keys';
import { registerSupplyMutations } from '@/features/supplies/use-supplies';
import { registerStepMutations } from '@/features/steps/use-steps';
import { registerTaskMutations, taskKeys } from '@/features/tasks/use-tasks';
import { moveRetryDelay, retryMove } from '@/lib/move-retry';

/** Milliseconds; the cache is thrown away after this long without a refresh. */
const CACHE_LIFETIME = 24 * 60 * 60 * 1000;

/** How long the lists wait for one move resumed from the queue before they refresh anyway. */
export const MOVE_WAIT_MS = 15_000;

const noop = () => undefined;

/** The move as far as `wait` goes: settled when it settles, or once the wait runs out. */
function atMost(move: Promise<unknown>, wait: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const runOut = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, wait);
  });
  return Promise.race([move, runOut]).finally(() => clearTimeout(timer));
}

/**
 * TanStack's client, except that no move holds the lists for long.
 *
 * Before it refreshes the lists when the app comes to the front — and before
 * its step on reconnect, which refetches no list here: they read with
 * networkMode 'always' — TanStack resumes the queue paused meanwhile and waits
 * for all of it; so does the start (`resumeSavedMoves`). A video takes
 * minutes over mobile data, and every list on the phone would wait as long
 * (the two whole-branch reviews of phone-1-2-0, finding 1). The videos' line
 * is resumed with the rest and not waited for:
 * each upload refreshes its own step's lists once it is in
 * (`registerMediaMutations`).
 *
 * Every other move is waited for, so the lists read after it show what it did
 * — but for MOVE_WAIT_MS at most. A move the network keeps failing is never
 * dropped (lib/move-retry.ts), and while it waits for the server its promise
 * does not settle: waited for to the end, it held every refresh on focus and
 * on reconnect for as long (the verification review of c466bf5..bc7dcc9,
 * item 2). Past the wait the lists go ahead; the move keeps going, and stays
 * in the queue until it lands. Otherwise as TanStack's own: nothing is resumed
 * without signal.
 */
class AppQueryClient extends QueryClient {
  override resumePausedMutations(): Promise<unknown> {
    if (!onlineManager.isOnline()) {
      return Promise.resolve();
    }
    const paused = this.getMutationCache()
      .getAll()
      .filter((mutation) => mutation.state.isPaused);
    return notifyManager.batch(() =>
      Promise.all(
        paused.map((mutation) => {
          const run = mutation.continue().catch(noop);
          return isVideoUpload(mutation) ? undefined : atMost(run, MOVE_WAIT_MS);
        }),
      ),
    );
  }
}

/**
 * The query client and its store on disk.
 *
 * Resilience to a dropped connection, not offline work. The list a cleaner
 * saw last is shown again on launch instead of a spinner, and an action
 * tapped in a stairwell waits on disk until there is signal, then goes
 * through — the phone does not have to stay open on that screen. Full offline
 * — cache for tomorrow, photos queued, conflict handling — is a later step.
 *
 * Mutations are 'offlineFirst': the first attempt is made at once, and a
 * failure for lack of network pauses at once rather than errors, however many
 * came before (lib/move-retry.ts) — a queued action is never dropped by the
 * network. Everything else fails loudly so the screen can show why and offer
 * a retry. Uploads keep their own budgets (features/media/attach-retry.ts).
 *
 * Queries keep 'always': a list read without signal fails and says so, with
 * the cached copy on screen, exactly as before the client could tell it was
 * offline — a spinner that waits for the network would read as a hang.
 */
export function createAppQueryClient(): QueryClient {
  const queryClient = new AppQueryClient({
    defaultOptions: {
      queries: {
        // A cleaner's phone drops to no signal inside stairwells more often
        // than the server actually fails.
        networkMode: 'always',
        retry: 2,
        staleTime: 30_000,
        gcTime: CACHE_LIFETIME,
      },
      mutations: {
        networkMode: 'offlineFirst',
        retry: retryMove,
        retryDelay: moveRetryDelay,
      },
    },
  });

  // Before the persisted cache is restored: a paused mutation restored
  // without its default has nothing to run.
  registerTaskMutations(queryClient);
  registerStepMutations(queryClient);
  registerMediaMutations(queryClient);
  registerProblemMutations(queryClient);
  registerSupplyMutations(queryClient);
  registerChatMutations(queryClient);
  registerSettingsMutations(queryClient);

  return queryClient;
}

/** Signed links (`mediaKeys.urls`): good for an hour, and no upload changes them. */
const SIGNED_LINKS = mediaKeys.urls([]);

function isSignedLinks(key: QueryKey): boolean {
  return SIGNED_LINKS.every((part, index) => key[index] === part);
}

/**
 * Once the cache is back from disk: the moves tapped without signal go
 * through, and the lists they change are refreshed — the cleanings, their
 * steps and the files on them. A move restored from disk has no screen of its
 * own to refresh them. The videos' line is not waited for, and any other move
 * for MOVE_WAIT_MS at most (`AppQueryClient`): each video refreshes its step
 * when it is in. Signed links are left as they are: asking them again would
 * only load every picture again.
 */
export async function resumeSavedMoves(queryClient: QueryClient): Promise<void> {
  await queryClient.resumePausedMutations();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.all }),
    queryClient.invalidateQueries({ queryKey: stepKeys.all }),
    queryClient.invalidateQueries({
      queryKey: mediaKeys.all,
      predicate: (query) => !isSignedLinks(query.queryKey),
    }),
  ]);
}

/** Where the cache lives on disk: the lists she saw and the moves waiting for signal. */
export const QUERY_CACHE_KEY = 'str-ops.query-cache';

// A change to what a task looks like must not restore an older shape into
// screens that expect the new one. Bump when the task schema changes.
//
// A bump also throws away the mutations paused on disk — whatever a cleaner
// tapped without signal. So a query whose shape changes is better read
// through its schema on the way out (`select`, as useMessages does since the
// chat photos' OTA restored threads without `task_media` and the screen
// closed the app), and the bump kept for when that cannot be done.
//
// v6: the task carries the building it stands in (`property.parent`) and the
// street (`property.address`). A row restored from v5 has neither key, and
// the cache is restored by JSON.parse — zod never sees it — so the screens
// would read `parent` off a row that has no such field.
const CACHE_BUSTER = 'tasks-v6';

const diskPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: QUERY_CACHE_KEY,
  // Writes are debounced: a list that re-renders while scrolling does not hit
  // the disk on every frame.
  throttleTime: 1_000,
});

/**
 * A saved cache past its day, as the restore is to see it: without its lists,
 * with its queue, and stamped now so the restore keeps it.
 *
 * TanStack throws a cache older than `maxAge` away whole, the moves waiting
 * for signal with the lists — a «Готово» tapped without signal on Friday was
 * gone on Monday (the verification review of c466bf5..bc7dcc9, item 1). The
 * lists are a day old and not worth showing; the moves are her work, and each
 * goes through an idempotent call with an id the phone made (CLAUDE.md), so
 * sending it late is safe — the server decides what it still allows.
 *
 * Anything else is handed on as it was read, for the restore to decide as
 * before: a cache within its day, one with nothing queued, one with no stamp,
 * and one saved by a build with another buster — whose shapes may no longer
 * be readable, queue and all.
 */
function keepQueueOfExpired(saved: PersistedClient | undefined): PersistedClient | undefined {
  if (saved === undefined || !saved.timestamp || saved.buster !== CACHE_BUSTER) {
    return saved;
  }
  const now = Date.now();
  const isExpired = now - saved.timestamp > CACHE_LIFETIME;
  const queued: unknown = isPersistedClient(saved) ? saved.clientState.mutations : undefined;
  if (!isExpired || !Array.isArray(queued) || queued.length === 0) {
    return saved;
  }
  return { ...saved, timestamp: now, clientState: { ...saved.clientState, queries: [] } };
}

export const queryPersister: Persister = {
  persistClient: diskPersister.persistClient,
  removeClient: diskPersister.removeClient,
  restoreClient: async () => keepQueueOfExpired(await diskPersister.restoreClient()),
};

export const persistOptions = {
  persister: queryPersister,
  maxAge: CACHE_LIFETIME,
  buster: CACHE_BUSTER,
};

/**
 * Drop the saved lists and keep the moves waiting for signal.
 *
 * The way out of a screen that cannot draw what the cache restored: the root
 * error screen offers it next to "retry", which on its own restores the same
 * lists again. Only the queries go — the paused mutations, the stamp and the
 * buster stay, so the next start still sends what she tapped without signal.
 * Bumping the buster would clear the lists too, and the queue with them.
 *
 * The lists in memory need nothing: the root boundary has unmounted the root
 * layout that held the client, and drawing it again creates a new one and
 * restores it from what is written here.
 *
 * Written twice on purpose. The persister's own write is throttled, and a
 * snapshot the crashed client queued in its last second would otherwise land
 * after ours; handing it the cleared state replaces that snapshot. The direct
 * write is the one awaited, so the restore that follows reads it.
 *
 * A saved state that cannot be read is left alone: the restore discards it
 * itself, and there is no queue in it left to keep.
 */
export async function forgetSavedQueries(): Promise<void> {
  const cleared = await savedWithoutLists();
  if (cleared === null) {
    return;
  }

  void queryPersister.persistClient(cleared);
  await AsyncStorage.setItem(QUERY_CACHE_KEY, JSON.stringify(cleared));
}

/**
 * Forget, on disk, the lists of whoever signed out or is no longer the one
 * signed in, and keep the moves waiting for signal (item 10 of the two
 * whole-branch reviews of phone-1-2-0; features/auth/forget-on-sign-out.ts,
 * which forgets them in memory). Some lists are not keyed by the person
 * («Задания», the supplies): the next person on a shared phone would see the
 * last one's before their own first read. What becomes of the last person's
 * queued moves is the owner's to decide; until then they stay, as «reset
 * saved lists» keeps them.
 *
 * Written straight to disk and not through the persister: the client is
 * alive, and the persister's own write, made a moment later on the queries'
 * removal, is of the cache as it now is. The direct one stands if the app is
 * closed before that moment. The queue on disk is left as it was saved.
 */
export async function forgetSavedListsOfSignedOut(): Promise<void> {
  const cleared = await savedWithoutLists();
  if (cleared !== null) {
    await AsyncStorage.setItem(QUERY_CACHE_KEY, JSON.stringify(cleared));
  }
}

/** What is saved on disk without its lists; null when nothing readable is saved. */
async function savedWithoutLists(): Promise<PersistedClient | null> {
  const saved = await readSavedClient();
  return saved === null ? null : { ...saved, clientState: { ...saved.clientState, queries: [] } };
}

async function readSavedClient(): Promise<PersistedClient | null> {
  const raw = await AsyncStorage.getItem(QUERY_CACHE_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPersistedClient(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPersistedClient(value: unknown): value is PersistedClient {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { clientState } = value as { clientState?: unknown };
  return typeof clientState === 'object' && clientState !== null;
}
