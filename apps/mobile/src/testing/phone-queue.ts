import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';

import {
  CACHE_OWNER_KEY,
  createRestoreGate,
  forgetListsOnSignOut,
} from '@/features/auth/forget-on-sign-out';
import {
  QUERY_CACHE_KEY,
  createAppQueryClient,
  persistOptions,
  queryPersister,
  saveCacheNow,
} from '@/lib/query-client';

/**
 * A phone's queue across restarts, as the root layout runs it: the app's own
 * client, restored from the real disk (the AsyncStorage stand-in), listening
 * to auth through `forgetListsOnSignOut`. The test file mocks
 * `@/lib/supabase` and hands its auth events to the listener it captured.
 */

/** Where the moves waiting for their author live on disk, by author. */
export const PARKED_ON_DISK = `${QUERY_CACHE_KEY}.parked`;

/** A move as this build writes it to disk: paused, with its author — or none, as older builds wrote it. */
export function savedMove(
  mutationKey: readonly unknown[],
  variables: unknown,
  scope: string | undefined,
  author?: string,
): Record<string, unknown> {
  return {
    mutationKey,
    ...(scope === undefined ? {} : { scope: { id: scope } }),
    state: {
      context: undefined,
      data: undefined,
      error: null,
      failureCount: 1,
      failureReason: null,
      isPaused: true,
      status: 'pending',
      variables,
      submittedAt: Date.now(),
    },
    ...(author === undefined ? {} : { meta: { authorId: author } }),
  };
}

/** The phone's disk as a build left it: the queue, no lists, and whose the cache was. */
export async function phoneLeftWith(moves: unknown[], owner: string | null): Promise<void> {
  await AsyncStorage.setItem(
    QUERY_CACHE_KEY,
    JSON.stringify({
      buster: persistOptions.buster,
      timestamp: Date.now(),
      clientState: { mutations: moves, queries: [] },
    }),
  );
  if (owner !== null) {
    await AsyncStorage.setItem(CACHE_OWNER_KEY, owner);
  }
}

export interface RunningApp {
  client: QueryClient;
  /** Closes the app: stops listening and empties the client in memory. */
  stop: () => void;
}

/** The app started: its client, restored from disk, listening to auth as the root layout does. */
export async function startApp(settle: () => Promise<void>): Promise<RunningApp> {
  const client = createAppQueryClient();
  const gate = createRestoreGate();
  const stopListening = forgetListsOnSignOut(client, gate.done, gate.markChecked);
  await persistQueryClientRestore({
    queryClient: client,
    persister: queryPersister,
    buster: persistOptions.buster,
    maxAge: persistOptions.maxAge,
  });
  gate.open();
  await settle();
  return {
    client,
    stop: () => {
      stopListening();
      client.clear();
    },
  };
}

/** What the persister writes for `client`, written now: the app closed. */
export async function closeApp(client: QueryClient): Promise<void> {
  await saveCacheNow(client);
}

/** The moves waiting on disk for `author`, by what they send. */
export async function parkedVariablesOf(author: string): Promise<unknown[]> {
  const parked: Record<string, { state: { variables: unknown } }[]> = JSON.parse(
    (await AsyncStorage.getItem(PARKED_ON_DISK)) ?? '{}',
  );
  return (parked[author] ?? []).map((move) => move.state.variables);
}

/** What the queue in memory still has to send. */
export function queuedVariables(client: QueryClient): unknown[] {
  return client
    .getMutationCache()
    .getAll()
    .filter((mutation) => mutation.state.status === 'pending')
    .map((mutation) => mutation.state.variables);
}

/** Lets every step already on its way to the disk finish, on real timers. */
export async function settleRealTime(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The same on Jest's fake timers. */
export async function settleFakeTime(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await jest.advanceTimersByTimeAsync(0);
  }
}
