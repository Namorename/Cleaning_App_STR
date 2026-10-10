import AsyncStorage from '@react-native-async-storage/async-storage';
import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';
import { renderHook, waitFor } from '@testing-library/react-native';

import { problemKeys } from '@/features/problems/keys';
import { useMyProblems } from '@/features/problems/use-problems';
import { taskMutationKeys } from '@/features/tasks/use-tasks';
import {
  QUERY_CACHE_KEY,
  createAppQueryClient,
  persistOptions,
  queryPersister,
} from '@/lib/query-client';
import { parkedVariablesOf } from '@/testing/phone-queue';
import { signedOutOfQueue } from '@/testing/queue-person';
import { withClient } from '@/testing/restored-cache';

import {
  CACHE_OWNER_KEY,
  OWNER_CHECK_WAIT_MS,
  createRestoreGate,
  forgetListsOnSignOut,
} from '../forget-on-sign-out';

/**
 * A phone handed from one person to another (item 10 of the two whole-branch
 * reviews of phone-1-2-0). Signing out forgets the lists of whoever left — in
 * memory and on disk — so the next person, whatever their role, sees none of
 * them before their own first read: some lists are not keyed by the person
 * («Задания», the supplies). The moves still waiting for signal are not lost:
 * they are parked on disk for their author (owner's decision of 2026-10-09;
 * queue-of-author.test.tsx says the rest).
 *
 * A sign-out can come before anything listens — auth-js lets a session go
 * while it starts, before the root layout is drawn — so the cache on disk is
 * stamped with whose lists it holds, and the first session known that is
 * somebody else's forgets them (the verification review of
 * f3217a7..c466bf5, item 2). A launch without a session — offline, the token
 * expired — forgets nothing.
 */

type AuthListener = (event: string, session: { user: { id: string } } | null) => void;

const mockAuth: { listener: AuthListener | null; userId: string | null } = {
  listener: null,
  userId: null,
};
const mockUnsubscribe = jest.fn();

jest.mock('@/lib/supabase', () => ({
  SESSION_STORAGE_KEY: 'sb-project-auth-token',
  supabase: {
    auth: {
      onAuthStateChange: (listener: AuthListener) => {
        mockAuth.listener = listener;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
    },
  },
}));
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: mockAuth.userId }),
}));
jest.mock('@/features/problems/api', () => ({
  ...jest.requireActual('@/features/problems/api'),
  // The next person's first read has not come back yet.
  fetchMyProblems: jest.fn(() => new Promise(() => undefined)),
}));

const CLEANER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const HEAD_TECH = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const CLAIM = { taskId: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b', cleanerId: CLEANER };
const ALREADY_IN = Promise.resolve();

function sessionOf(userId: string) {
  return { user: { id: userId } };
}

let client: QueryClient;

/** The cleaner's phone as she leaves it: her lists, a claim waiting for signal, her stamp. */
async function cleanersPhone(): Promise<void> {
  client.setQueryData(problemKeys.mine(), [{ id: 'p1', title: 'Кран течёт' }]);
  client.setQueryData(['tasks', 'mine', CLEANER], [{ id: CLAIM.taskId }]);
  client.getMutationCache().build(
    client,
    { mutationKey: taskMutationKeys.claim },
    {
      context: undefined,
      data: undefined,
      error: null,
      failureCount: 1,
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
  await AsyncStorage.setItem(CACHE_OWNER_KEY, CLEANER);
}

function savedOnDisk(): Promise<{ clientState: { queries: unknown[]; mutations: unknown[] } }> {
  return AsyncStorage.getItem(QUERY_CACHE_KEY).then((raw) => JSON.parse(raw ?? '{}'));
}

/** The app started again: a new client, restored from disk as the root layout restores it. */
async function restart(): Promise<void> {
  client.clear();
  client = createAppQueryClient();
}

function restoreFromDisk(): Promise<void> {
  return persistQueryClientRestore({
    queryClient: client,
    persister: queryPersister,
    buster: persistOptions.buster,
    maxAge: persistOptions.maxAge,
  });
}

/** Lets every step already on its way to the disk finish. */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Whether the promise has settled by the time the microtasks queued so far have run. */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  let isSettled = false;
  void promise.then(() => {
    isSettled = true;
  });
  for (let round = 0; round < 5; round += 1) {
    await Promise.resolve();
  }
  return isSettled;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockAuth.listener = null;
  mockAuth.userId = CLEANER;
  client = createAppQueryClient();
  await cleanersPhone();
});

afterEach(() => {
  client.clear();
  signedOutOfQueue();
});

test('signing out forgets the lists in memory and on disk, and parks her moves waiting for signal', async () => {
  // Arrange
  forgetListsOnSignOut(client, ALREADY_IN);

  // Act
  mockAuth.listener?.('SIGNED_OUT', null);

  // Assert
  await waitFor(async () => expect((await savedOnDisk()).clientState.queries).toEqual([]));
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  await waitFor(async () => expect(await parkedVariablesOf(CLEANER)).toEqual([CLAIM]));
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

test('signed in as somebody else, no list of the one before is shown before the first read', async () => {
  // Arrange: the cleaner leaves; the head technician signs in on her phone.
  forgetListsOnSignOut(client, ALREADY_IN);
  mockAuth.listener?.('SIGNED_OUT', null);
  await waitFor(async () => expect((await savedOnDisk()).clientState.queries).toEqual([]));
  mockAuth.userId = HEAD_TECH;
  mockAuth.listener?.('SIGNED_IN', sessionOf(HEAD_TECH));

  // Act
  const { result } = await renderHook(() => useMyProblems(), { wrapper: withClient(client) });

  // Assert: none in memory, none on disk, the stamp his; her take parked for her.
  expect(result.current.data).toBeUndefined();
  expect(result.current.isPending).toBe(true);
  await waitFor(async () => expect(await AsyncStorage.getItem(CACHE_OWNER_KEY)).toBe(HEAD_TECH));
  expect((await savedOnDisk()).clientState.queries).toEqual([]);
  await waitFor(async () => expect(await parkedVariablesOf(CLEANER)).toEqual([CLAIM]));
});

test('anything but a sign-out or somebody else leaves the lists alone', async () => {
  forgetListsOnSignOut(client, ALREADY_IN);
  await settle();

  mockAuth.listener?.('INITIAL_SESSION', sessionOf(CLEANER));
  mockAuth.listener?.('TOKEN_REFRESHED', sessionOf(CLEANER));
  mockAuth.listener?.('USER_UPDATED', sessionOf(CLEANER));
  await settle();

  expect(client.getQueryData(problemKeys.mine())).toHaveLength(1);
  expect((await savedOnDisk()).clientState.queries).not.toEqual([]);
});

// The stamp says whose lists the disk holds. Written over lists the disk
// would not let go of, it would call the last person's lists the next one's,
// and no start would forget them again (the verification review of
// c466bf5..bc7dcc9, item 4).
test('a wipe the disk refuses leaves the stamp as it was, so the next start forgets again', async () => {
  // Arrange: the cleaner's lists and stamp; the disk will refuse the next write.
  forgetListsOnSignOut(client, ALREADY_IN);
  await settle();
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async () => {
    throw new Error('No space left on device');
  });

  // Act: the head technician signs in on her phone.
  mockAuth.listener?.('SIGNED_IN', sessionOf(HEAD_TECH));
  await settle();

  // Assert: gone from memory; on disk the wipe failed, and the stamp is still hers.
  expect(client.getQueryData(problemKeys.mine())).toBeUndefined();
  expect((await savedOnDisk()).clientState.queries).not.toEqual([]);
  expect(await AsyncStorage.getItem(CACHE_OWNER_KEY)).toBe(CLEANER);
});

test('stops listening when the app lets go of it', () => {
  const stop = forgetListsOnSignOut(client, ALREADY_IN);

  stop();

  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

describe('a sign-out nobody heard', () => {
  test('somebody else signing in after a restart sees none of the old lists, in memory or on disk', async () => {
    // Arrange: auth let her session go while the app started, before anything
    // listened; the restore brings her lists back.
    await restart();
    const gate = createRestoreGate();
    forgetListsOnSignOut(client, gate.done);
    mockAuth.userId = null;
    mockAuth.listener?.('INITIAL_SESSION', null);
    await restoreFromDisk();
    gate.open();
    await settle();
    expect(client.getQueryData(problemKeys.mine())).toHaveLength(1);

    // Act: the head technician signs in on her phone.
    mockAuth.userId = HEAD_TECH;
    mockAuth.listener?.('SIGNED_IN', sessionOf(HEAD_TECH));
    const { result } = await renderHook(() => useMyProblems(), { wrapper: withClient(client) });

    // Assert: her take is not his to send — parked for her.
    expect(result.current.data).toBeUndefined();
    await waitFor(async () => expect(await AsyncStorage.getItem(CACHE_OWNER_KEY)).toBe(HEAD_TECH));
    expect((await savedOnDisk()).clientState.queries).toEqual([]);
    await waitFor(async () => expect(await parkedVariablesOf(CLEANER)).toEqual([CLAIM]));
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  // The restore has read the disk and not yet put it in memory when the
  // session is known: forgotten then, the lists would come back with it.
  test('the session read at start is somebody else’s: what the restore brings back is forgotten', async () => {
    // Arrange
    await restart();
    const gate = createRestoreGate();
    forgetListsOnSignOut(client, gate.done);
    const read = (await savedOnDisk()).clientState as DehydratedState;
    mockAuth.userId = HEAD_TECH;
    mockAuth.listener?.('INITIAL_SESSION', sessionOf(HEAD_TECH));
    await settle();

    // Act: the restore puts what it read in memory, and says it is in.
    hydrate(client, read);
    gate.open();
    await settle();

    // Assert
    expect(client.getQueryData(problemKeys.mine())).toBeUndefined();
    await waitFor(async () => expect(await AsyncStorage.getItem(CACHE_OWNER_KEY)).toBe(HEAD_TECH));
    expect((await savedOnDisk()).clientState.queries).toEqual([]);
    await waitFor(async () => expect(await parkedVariablesOf(CLEANER)).toEqual([CLAIM]));
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  test('a sign-out heard before the cache is back still forgets what the restore brings', async () => {
    await restart();
    const gate = createRestoreGate();
    forgetListsOnSignOut(client, gate.done);
    const read = (await savedOnDisk()).clientState as DehydratedState;
    mockAuth.listener?.('SIGNED_OUT', null);
    await settle();

    hydrate(client, read);
    gate.open();
    await settle();

    expect(client.getQueryData(problemKeys.mine())).toBeUndefined();
    await waitFor(async () => expect((await savedOnDisk()).clientState.queries).toEqual([]));
    await waitFor(async () => expect(await parkedVariablesOf(CLEANER)).toEqual([CLAIM]));
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  test('a cache stamped by nobody is taken for somebody else’s: the first session forgets it', async () => {
    await AsyncStorage.removeItem(CACHE_OWNER_KEY);
    await restart();
    const gate = createRestoreGate();
    forgetListsOnSignOut(client, gate.done);
    await restoreFromDisk();
    gate.open();

    mockAuth.listener?.('INITIAL_SESSION', sessionOf(CLEANER));
    await settle();

    expect(client.getQueryData(problemKeys.mine())).toBeUndefined();
    await waitFor(async () => expect(await AsyncStorage.getItem(CACHE_OWNER_KEY)).toBe(CLEANER));
    expect((await savedOnDisk()).clientState.queries).toEqual([]);
  });
});

describe('the same person', () => {
  // A launch without signal and with a token that expired: auth knows no
  // session until it can refresh, and her lists are all she has to go on.
  test('offline, with no session known, keeps her lists in memory and on disk', async () => {
    // Arrange
    await restart();
    const gate = createRestoreGate();
    forgetListsOnSignOut(client, gate.done);
    mockAuth.userId = null;

    // Act
    mockAuth.listener?.('INITIAL_SESSION', null);
    await restoreFromDisk();
    gate.open();
    await settle();

    // Assert
    expect(client.getQueryData(problemKeys.mine())).toHaveLength(1);
    expect((await savedOnDisk()).clientState.queries).not.toEqual([]);
    expect(await AsyncStorage.getItem(CACHE_OWNER_KEY)).toBe(CLEANER);
  });

  test('back in once the signal is, keeps them too', async () => {
    await restart();
    const gate = createRestoreGate();
    forgetListsOnSignOut(client, gate.done);
    mockAuth.listener?.('INITIAL_SESSION', null);
    await restoreFromDisk();
    gate.open();
    await settle();

    mockAuth.listener?.('SIGNED_IN', sessionOf(CLEANER));
    mockAuth.listener?.('TOKEN_REFRESHED', sessionOf(CLEANER));
    await settle();

    expect(client.getQueryData(problemKeys.mine())).toHaveLength(1);
    expect((await savedOnDisk()).clientState.queries).not.toEqual([]);
  });
});

/**
 * The root's cache provider counts the restore done — and lets the screens
 * draw what it brought — only once the gate says the lists restored have been
 * checked against whose they are (the verification review of
 * c466bf5..bc7dcc9, item 5): otherwise the last person's lists could draw for
 * a frame before being forgotten.
 */
describe('the check of whose lists came back', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('is done only once the cache is back and the stamp read', async () => {
    // Arrange
    await restart();
    const gate = createRestoreGate();
    forgetListsOnSignOut(client, gate.done, gate.markChecked);
    await settle();
    expect(await hasSettled(gate.checked)).toBe(false);

    // Act
    await restoreFromDisk();
    gate.open();
    await settle();

    // Assert
    expect(await hasSettled(gate.checked)).toBe(true);
  });

  test('somebody else’s session heard meanwhile: by then the lists are gone from memory', async () => {
    // Arrange: the restore has read the disk; the head technician's session is known.
    await restart();
    const gate = createRestoreGate();
    let listsWhenChecked: unknown = 'not checked';
    forgetListsOnSignOut(client, gate.done, () => {
      listsWhenChecked = client.getQueryData(problemKeys.mine());
      gate.markChecked();
    });
    const read = (await savedOnDisk()).clientState as DehydratedState;
    mockAuth.userId = HEAD_TECH;
    mockAuth.listener?.('INITIAL_SESSION', sessionOf(HEAD_TECH));
    await settle();

    // Act: the restore puts what it read in memory, and says it is in.
    hydrate(client, read);
    gate.open();
    await settle();

    // Assert
    expect(listsWhenChecked).toBeUndefined();
    expect(await hasSettled(gate.checked)).toBe(true);
  });

  // A stamp that never comes back must not keep every screen waiting on the
  // restore: past the wait the lists draw, as they did before the check.
  test('a stamp that cannot be read in time holds nothing for long', async () => {
    // Arrange
    jest.useFakeTimers();
    jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise(() => undefined));
    const gate = createRestoreGate();
    forgetListsOnSignOut(client, gate.done, gate.markChecked);

    // Act
    gate.open();
    await jest.advanceTimersByTimeAsync(OWNER_CHECK_WAIT_MS - 100);
    const isCheckedEarly = await hasSettled(gate.checked);
    await jest.advanceTimersByTimeAsync(200);

    // Assert
    expect(isCheckedEarly).toBe(false);
    expect(await hasSettled(gate.checked)).toBe(true);
  });
});
