import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

import { registerChatMutations } from '@/features/chat/use-chat';
import { registerMediaMutations } from '@/features/media/use-media';
import { registerProblemMutations } from '@/features/problems/use-problems';
import { registerSupplyMutations } from '@/features/supplies/use-supplies';
import { registerStepMutations } from '@/features/steps/use-steps';
import { registerTaskMutations } from '@/features/tasks/use-tasks';

/** Milliseconds; the cache is thrown away after this long without a refresh. */
const CACHE_LIFETIME = 24 * 60 * 60 * 1000;

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
 * failure for lack of network pauses rather than errors. Everything else fails
 * loudly so the screen can show why and offer a retry.
 */
export function createAppQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // A cleaner's phone drops to no signal inside stairwells more often
        // than the server actually fails.
        retry: 2,
        staleTime: 30_000,
        gcTime: CACHE_LIFETIME,
      },
      mutations: {
        networkMode: 'offlineFirst',
        retry: 1,
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

  return queryClient;
}

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'str-ops.query-cache',
  // Writes are debounced: a list that re-renders while scrolling does not hit
  // the disk on every frame.
  throttleTime: 1_000,
});

export const persistOptions = {
  persister: queryPersister,
  maxAge: CACHE_LIFETIME,
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
  buster: 'tasks-v6',
};
