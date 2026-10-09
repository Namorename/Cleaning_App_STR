import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  QueryClient,
  QueryObserver,
  dehydrate,
  focusManager,
  onlineManager,
  type MutationState,
} from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';
import { waitFor } from '@testing-library/react-native';

import { mediaKeys } from '@/features/media/keys';
import { mediaMutationKeys } from '@/features/media/use-media';
import { settingsMutationKeys } from '@/features/settings/keys';
import { stepKeys } from '@/features/steps/keys';
import { claimTask } from '@/features/tasks/api';
import { taskMutationKeys } from '@/features/tasks/use-tasks';

import {
  MOVE_WAIT_MS,
  QUERY_CACHE_KEY,
  createAppQueryClient,
  forgetSavedQueries,
  persistOptions,
  queryPersister,
  resumeSavedMoves,
} from '../query-client';

jest.mock('@/features/tasks/api', () => ({
  ...jest.requireActual('@/features/tasks/api'),
  claimTask: jest.fn(),
}));

/**
 * "Reset saved lists" on the root error screen.
 *
 * A render error caused by what the cache restored from disk comes back on
 * every retry: the retry restores the same thing. Dropping the saved lists
 * cures that; dropping the moves she tapped without signal would lose work,
 * and that is what bumping the buster does — which is why this exists.
 */

const CLAIM = { taskId: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b', cleanerId: 'u1' };

/**
 * What the app keeps on disk: one list the screen cannot draw, one claim
 * waiting for signal — or none, `isClaimQueued` false — saved by a build
 * with `buster`.
 */
async function saveCacheWithPausedClaim({
  buster = persistOptions.buster,
  isClaimQueued = true,
}: { buster?: string; isClaimQueued?: boolean } = {}): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  client.setQueryData(['tasks', 'mine', 'u1'], [{ id: 'not-a-task', broken: true }]);
  if (isClaimQueued) {
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
  }

  await AsyncStorage.setItem(
    QUERY_CACHE_KEY,
    JSON.stringify({ buster, timestamp: Date.now(), clientState: dehydrate(client) }),
  );
  client.clear();
}

/** The next launch: a client of the app's, restored from disk as the root layout restores it. */
async function launch(): Promise<QueryClient> {
  const client = createAppQueryClient();
  await persistQueryClientRestore({
    queryClient: client,
    persister: queryPersister,
    buster: persistOptions.buster,
    maxAge: persistOptions.maxAge,
  });
  return client;
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

// A choice paused without signal comes back from disk as a key and its
// variables; without a function registered under the key before the restore,
// there is nothing to run and her switch is silently lost.
test('knows how to replay a push choice before anything is restored', () => {
  // Act
  const client = createAppQueryClient();

  // Assert
  expect(client.getMutationDefaults(settingsMutationKeys.push).mutationFn).toEqual(
    expect.any(Function),
  );
  client.clear();
});

test('knows how to replay an accept before anything is restored', () => {
  // Act
  const client = createAppQueryClient();

  // Assert
  expect(taskMutationKeys.accept).toEqual(['tasks', 'accept']);
  expect(client.getMutationDefaults(taskMutationKeys.accept).mutationFn).toEqual(
    expect.any(Function),
  );
  client.clear();
});

// A take, an accept, a start and a finish queued together replay one after
// another, in the order she tapped them: a start landing before the accept
// would turn the accept into a refusal while she is cleaning.
test('the moves of a cleaning replay one at a time, in the order tapped', () => {
  const client = createAppQueryClient();

  const scopes = Object.values(taskMutationKeys).map(
    (key) => client.getMutationDefaults(key).scope?.id,
  );

  expect(new Set(scopes)).toEqual(new Set(['task-moves']));
  client.clear();
});

test('with nothing saved, writes nothing', async () => {
  // Act
  await forgetSavedQueries();

  // Assert
  expect(await AsyncStorage.getItem(QUERY_CACHE_KEY)).toBeNull();
});

/**
 * The cache lives a day: lists older than that are not worth showing. The
 * queue saved with them is a different matter — TanStack throws an expired
 * cache away whole, and a «Готово» tapped without signal on Friday was gone
 * on Monday (the verification review of c466bf5..bc7dcc9, item 1). An
 * expired cache comes back without its lists and with its queue.
 */
describe('a cache older than its day', () => {
  const FRIDAY = new Date('2026-10-09T16:00:00Z').getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MONDAY = FRIDAY + 3 * DAY_MS;

  beforeEach(() => {
    jest.useFakeTimers({ now: FRIDAY });
    onlineManager.setOnline(true);
    jest.mocked(claimTask).mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a take queued on Friday comes back on Monday without the lists, and goes through', async () => {
    // Arrange
    await saveCacheWithPausedClaim();
    jest.setSystemTime(MONDAY);
    jest.mocked(claimTask).mockResolvedValue({ id: CLAIM.taskId } as never);

    // Act
    const client = await launch();

    // Assert: the claim is back, paused; the lists are not.
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    const [claim] = client.getMutationCache().getAll();
    expect(claim.state.variables).toEqual(CLAIM);
    expect(claim.state.isPaused).toBe(true);

    // Act: the start resumes what was restored.
    await resumeSavedMoves(client);

    // Assert
    expect(claimTask).toHaveBeenCalledWith(CLAIM.taskId, CLAIM.cleanerId);
    expect(claim.state.status).toBe('success');
    client.clear();
  });

  test('a day and a minute old, the lists are dropped and the queue kept', async () => {
    await saveCacheWithPausedClaim();
    jest.setSystemTime(FRIDAY + DAY_MS + 60_000);

    const client = await launch();

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getMutationCache().getAll()).toHaveLength(1);
    client.clear();
  });

  test('within its day, the lists come back with the queue, as before', async () => {
    await saveCacheWithPausedClaim();
    jest.setSystemTime(FRIDAY + DAY_MS - 60_000);

    const client = await launch();

    expect(client.getQueryCache().getAll()).toHaveLength(1);
    expect(client.getMutationCache().getAll()).toHaveLength(1);
    client.clear();
  });

  test('with nothing queued, it is thrown away from disk, as before', async () => {
    await saveCacheWithPausedClaim({ isClaimQueued: false });
    jest.setSystemTime(MONDAY);

    const client = await launch();

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(await AsyncStorage.getItem(QUERY_CACHE_KEY)).toBeNull();
    client.clear();
  });

  // A bump says the saved shapes can no longer be read: the queue goes with
  // them, as it always has (persistOptions.buster).
  test.each([
    ['within its day', FRIDAY + 60_000],
    ['older than its day', MONDAY],
  ])(
    'saved by a build with another buster, %s, it is thrown away whole, as before',
    async (_, now) => {
      await saveCacheWithPausedClaim({ buster: 'tasks-v5' });
      jest.setSystemTime(now);

      const client = await launch();

      expect(client.getQueryCache().getAll()).toHaveLength(0);
      expect(client.getMutationCache().getAll()).toHaveLength(0);
      expect(await AsyncStorage.getItem(QUERY_CACHE_KEY)).toBeNull();
      client.clear();
    },
  );
});

/**
 * A video takes minutes over mobile data, and the lists must not wait for it
 * (the two whole-branch reviews of phone-1-2-0, finding 1). TanStack resumes
 * the paused queue and only then refreshes the lists — on a restart, when the
 * signal comes back and when the app comes to the front. A video's line is
 * resumed with the rest and not waited for: its own upload refreshes its
 * step's lists when it is in.
 */
describe('the queue on disk, and a video in it', () => {
  const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

  function pausedState(variables: unknown): MutationState<unknown, Error, unknown, unknown> {
    return {
      context: undefined,
      data: undefined,
      error: null,
      failureCount: 1,
      failureReason: null,
      isPaused: true,
      status: 'pending',
      variables,
      submittedAt: Date.now(),
    };
  }

  /** A video waiting for signal whose upload, once resumed, takes longer than any test. */
  function pausedVideo(client: QueryClient): jest.Mock {
    const upload = jest.fn(() => new Promise<never>(() => undefined));
    client.getMutationCache().build(
      client,
      {
        mutationKey: mediaMutationKeys.attach,
        scope: { id: 'media-attach-video' },
        mutationFn: upload,
      },
      pausedState({ mediaId: 'v1', kind: 'video', taskId: TASK_ID }),
    );
    return upload;
  }

  let client: QueryClient;

  beforeEach(() => {
    onlineManager.setOnline(true);
    client = createAppQueryClient();
  });

  afterEach(() => {
    client.unmount();
    client.clear();
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  test('after a restart, the moves’ lists refresh without waiting for the video', async () => {
    // Arrange: a claim and a video waiting on disk; the lists they show up in.
    const upload = pausedVideo(client);
    client
      .getMutationCache()
      .build(
        client,
        { mutationKey: taskMutationKeys.claim, mutationFn: async () => undefined },
        pausedState(CLAIM),
      );
    client.setQueryData(['tasks', 'mine', 'u1'], []);
    client.setQueryData(stepKeys.byTask(TASK_ID), []);
    client.setQueryData(mediaKeys.byTask(TASK_ID), []);
    client.setQueryData(mediaKeys.local, {});
    client.setQueryData(mediaKeys.urls(['host-1/p1.jpg']), { 'host-1/p1.jpg': 'https://signed' });

    // Act
    await resumeSavedMoves(client);

    // Assert: the video is on its way, and the lists were not held for it.
    expect(upload).toHaveBeenCalled();
    expect(client.getQueryState(['tasks', 'mine', 'u1'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(stepKeys.byTask(TASK_ID))?.isInvalidated).toBe(true);
    expect(client.getQueryState(mediaKeys.byTask(TASK_ID))?.isInvalidated).toBe(true);
    expect(client.getQueryState(mediaKeys.local)?.isInvalidated).toBe(true);
    // Links signed an hour ahead are not asked again: no upload changes them.
    expect(client.getQueryState(mediaKeys.urls(['host-1/p1.jpg']))?.isInvalidated).toBe(false);
  });

  // Only the video is let go of: every other move is waited for, so the lists
  // read after it show what the move did (verification review of
  // f3217a7..c466bf5, item 4).
  test('after a restart, the lists wait for a slow move that is not a video', async () => {
    // Arrange: a video and a claim on disk; the claim's server takes its time.
    pausedVideo(client);
    let land: () => void = () => undefined;
    const claim = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );
    client
      .getMutationCache()
      .build(
        client,
        { mutationKey: taskMutationKeys.claim, mutationFn: claim },
        pausedState(CLAIM),
      );
    client.setQueryData(['tasks', 'mine', 'u1'], []);

    // Act
    const resumed = resumeSavedMoves(client);
    await waitFor(() => expect(claim).toHaveBeenCalled());

    // Assert: nothing refreshed while the claim is on its way; refreshed once it lands.
    expect(client.getQueryState(['tasks', 'mine', 'u1'])?.isInvalidated).toBe(false);
    land();
    await resumed;
    expect(client.getQueryState(['tasks', 'mine', 'u1'])?.isInvalidated).toBe(true);
  });

  /** A list on screen, read once already; returns how often it was read again. */
  async function listOnScreen(): Promise<{ reads: jest.Mock; stop: () => void }> {
    const reads = jest.fn(async () => ['fresh']);
    const observer = new QueryObserver(client, {
      queryKey: ['tasks', 'mine', 'u1'],
      queryFn: reads,
      staleTime: 0,
    });
    const stop = observer.subscribe(() => undefined);
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
    reads.mockClear();
    return { reads, stop };
  }

  // What TanStack waits for before it refreshes anything — on reconnect, on
  // focus, at start — settles while the video is still on its way. (The lists
  // read with networkMode 'always', so a reconnect alone refetches none of
  // them; the front and the start do.)
  test('the queue resumed, the video sets off and nothing waits for it', async () => {
    // Arrange
    const upload = pausedVideo(client);
    const settled = jest.fn();

    // Act
    void client.resumePausedMutations().then(settled);

    // Assert
    await waitFor(() => expect(settled).toHaveBeenCalled());
    expect(upload).toHaveBeenCalled();
  });

  test('without signal, nothing is resumed', async () => {
    const upload = pausedVideo(client);
    onlineManager.setOnline(false);

    await client.resumePausedMutations();

    expect(upload).not.toHaveBeenCalled();
  });

  test('back in front, the lists refresh while a video in the queue goes up', async () => {
    // Arrange
    client.mount();
    const list = await listOnScreen();
    pausedVideo(client);

    // Act
    focusManager.setFocused(false);
    focusManager.setFocused(true);

    // Assert
    await waitFor(() => expect(list.reads).toHaveBeenCalledTimes(1));
    list.stop();
  });

  /**
   * A move the network keeps failing is never dropped now (lib/move-retry.ts),
   * and its promise never settles while it waits; every refresh TanStack makes
   * on focus or reconnect waited behind it (the verification review of
   * c466bf5..bc7dcc9, item 2). Each move is waited for a while, then the
   * lists go ahead and the move keeps going in the queue.
   */
  describe('a move that never settles', () => {
    /** A claim restored from disk whose server never answers. */
    function stuckClaim(): jest.Mock {
      const claim = jest.fn(() => new Promise<never>(() => undefined));
      client
        .getMutationCache()
        .build(
          client,
          { mutationKey: taskMutationKeys.claim, mutationFn: claim },
          pausedState(CLAIM),
        );
      return claim;
    }

    afterEach(() => {
      jest.useRealTimers();
    });

    test('back in front, the lists wait for it a while, then refresh; the move stays queued', async () => {
      // Arrange
      jest.useFakeTimers();
      client.mount();
      const list = await listOnScreen();
      const claim = stuckClaim();

      // Act
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await jest.advanceTimersByTimeAsync(MOVE_WAIT_MS - 1_000);

      // Assert: on its way, and waited for so far.
      expect(claim).toHaveBeenCalledTimes(1);
      expect(list.reads).not.toHaveBeenCalled();

      // Act: the wait runs out.
      await jest.advanceTimersByTimeAsync(2_000);

      // Assert
      expect(list.reads).toHaveBeenCalledTimes(1);
      const [move] = client.getMutationCache().getAll();
      expect(move.state.status).toBe('pending');
      list.stop();
    });

    test('at a restart, the lists of the moves refresh once the wait runs out', async () => {
      // Arrange
      jest.useFakeTimers();
      stuckClaim();
      client.setQueryData(['tasks', 'mine', 'u1'], []);

      // Act
      const resumed = resumeSavedMoves(client);
      await jest.advanceTimersByTimeAsync(MOVE_WAIT_MS + 1_000);
      await resumed;

      // Assert
      expect(client.getQueryState(['tasks', 'mine', 'u1'])?.isInvalidated).toBe(true);
      expect(client.getMutationCache().getAll()[0].state.status).toBe('pending');
    });
  });
});
