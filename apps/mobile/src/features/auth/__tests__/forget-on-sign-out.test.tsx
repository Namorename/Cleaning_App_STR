import AsyncStorage from '@react-native-async-storage/async-storage';
import { dehydrate, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { problemKeys } from '@/features/problems/keys';
import { useMyProblems } from '@/features/problems/use-problems';
import { taskMutationKeys } from '@/features/tasks/use-tasks';
import { QUERY_CACHE_KEY, createAppQueryClient, persistOptions } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';

import { forgetListsOnSignOut } from '../forget-on-sign-out';

/**
 * A phone handed from one person to another (item 10 of the two whole-branch
 * reviews of phone-1-2-0). Signing out forgets the lists of whoever left — in
 * memory and on disk — so the next person, whatever their role, sees none of
 * them before their own first read: some lists are not keyed by the person
 * («Задания», the supplies). The moves still waiting for signal are kept, as
 * the root's «reset saved lists» keeps them; what becomes of a previous
 * person's queued moves on a shared phone is the owner's to decide.
 */

type AuthListener = (event: string) => void;

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

let client: QueryClient;

/** The cleaner's phone as she leaves it: her lists, and a claim waiting for signal. */
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
}

function savedOnDisk(): Promise<{ clientState: { queries: unknown[]; mutations: unknown[] } }> {
  return AsyncStorage.getItem(QUERY_CACHE_KEY).then((raw) => JSON.parse(raw ?? '{}'));
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
});

test('signing out forgets the lists in memory and on disk, and keeps the moves waiting for signal', async () => {
  // Arrange
  forgetListsOnSignOut(client);

  // Act
  mockAuth.listener?.('SIGNED_OUT');

  // Assert
  await waitFor(async () => expect((await savedOnDisk()).clientState.queries).toEqual([]));
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(client.getMutationCache().getAll()).toHaveLength(1);
  expect((await savedOnDisk()).clientState.mutations).toHaveLength(1);
});

test('signed in as somebody else, no list of the one before is shown before the first read', async () => {
  // Arrange: the cleaner leaves; the head technician signs in on her phone.
  forgetListsOnSignOut(client);
  mockAuth.listener?.('SIGNED_OUT');
  await waitFor(async () => expect((await savedOnDisk()).clientState.queries).toEqual([]));
  mockAuth.userId = HEAD_TECH;
  mockAuth.listener?.('SIGNED_IN');

  // Act
  const { result } = await renderHook(() => useMyProblems(), { wrapper: withClient(client) });

  // Assert
  expect(result.current.data).toBeUndefined();
  expect(result.current.isPending).toBe(true);
});

test('anything but a sign-out leaves the lists alone', async () => {
  forgetListsOnSignOut(client);

  mockAuth.listener?.('TOKEN_REFRESHED');
  mockAuth.listener?.('USER_UPDATED');

  expect(client.getQueryData(problemKeys.mine())).toHaveLength(1);
});

test('stops listening when the app lets go of it', () => {
  const stop = forgetListsOnSignOut(client);

  stop();

  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});
