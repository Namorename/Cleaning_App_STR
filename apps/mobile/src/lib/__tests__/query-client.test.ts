import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';

import { taskMutationKeys } from '@/features/tasks/use-tasks';

import { QUERY_CACHE_KEY, forgetSavedQueries, persistOptions, queryPersister } from '../query-client';

/**
 * "Reset saved lists" on the root error screen.
 *
 * A render error caused by what the cache restored from disk comes back on
 * every retry: the retry restores the same thing. Dropping the saved lists
 * cures that; dropping the moves she tapped without signal would lose work,
 * and that is what bumping the buster does — which is why this exists.
 */

const CLAIM = { taskId: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b', cleanerId: 'u1' };

/** What the app keeps on disk: one list the screen cannot draw, one claim waiting for signal. */
async function saveCacheWithPausedClaim(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  client.setQueryData(['tasks', 'mine', 'u1'], [{ id: 'not-a-task', broken: true }]);
  client.getMutationCache().build(
    client,
    { mutationKey: taskMutationKeys.claim },
    {
      context: undefined,
      data: undefined,
      error: null,
      failureCount: 0,
      failureReason: null,
      isPaused: true,
      status: 'pending',
      variables: CLAIM,
      submittedAt: Date.now(),
    },
  );

  await AsyncStorage.setItem(
    QUERY_CACHE_KEY,
    JSON.stringify({
      buster: persistOptions.buster,
      timestamp: Date.now(),
      clientState: dehydrate(client),
    }),
  );
  client.clear();
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('drops the saved lists and keeps the moves waiting for signal', async () => {
  // Arrange
  await saveCacheWithPausedClaim();

  // Act
  await forgetSavedQueries();

  // Assert: what the next launch restores has the claim and none of the lists.
  const restored = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  await persistQueryClientRestore({
    queryClient: restored,
    persister: queryPersister,
    buster: persistOptions.buster,
    maxAge: persistOptions.maxAge,
  });

  expect(restored.getQueryCache().getAll()).toHaveLength(0);
  const [claim] = restored.getMutationCache().getAll();
  expect(claim.options.mutationKey).toEqual(taskMutationKeys.claim);
  expect(claim.state.variables).toEqual(CLAIM);
  expect(claim.state.isPaused).toBe(true);
  restored.clear();
});

test('keeps the stamp and the buster, so the queue is not thrown away as stale', async () => {
  // Arrange
  await saveCacheWithPausedClaim();
  const before = JSON.parse((await AsyncStorage.getItem(QUERY_CACHE_KEY)) ?? '{}');

  // Act
  await forgetSavedQueries();

  // Assert
  const after = JSON.parse((await AsyncStorage.getItem(QUERY_CACHE_KEY)) ?? '{}');
  expect(after.buster).toBe(before.buster);
  expect(after.timestamp).toBe(before.timestamp);
  expect(after.clientState.mutations).toEqual(before.clientState.mutations);
  expect(after.clientState.queries).toEqual([]);
});

test('with nothing saved, writes nothing', async () => {
  // Act
  await forgetSavedQueries();

  // Assert
  expect(await AsyncStorage.getItem(QUERY_CACHE_KEY)).toBeNull();
});
