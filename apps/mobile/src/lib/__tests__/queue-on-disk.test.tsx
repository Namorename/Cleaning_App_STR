import AsyncStorage from '@react-native-async-storage/async-storage';
import { MutationObserver, onlineManager, type QueryClient } from '@tanstack/react-query';
import { persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { assignProblem } from '@/features/board/api';
import { useAssignProblem } from '@/features/board/use-board';
import { changePassword } from '@/features/settings/password';
import { useChangePassword } from '@/features/settings/use-settings';
import { claimTask } from '@/features/tasks/api';
import { taskMutationKeys, type ClaimVariables } from '@/features/tasks/use-tasks';
import { QUERY_CACHE_KEY, persistOptions } from '@/lib/query-client';
import { settleRealTime, startApp, type RunningApp } from '@/testing/phone-queue';
import { signedOutOfQueue } from '@/testing/queue-person';
import { withClient } from '@/testing/restored-cache';

/**
 * What of the queue reaches the disk.
 *
 * TanStack saves only the moves paused for lack of signal; a move whose
 * request was on its way when the app was closed was lost (night journal,
 * «not tried yet»). The field moves and uploads are saved on their way as
 * well — as waiting, so the next start sends them again: each is an
 * idempotent call with an id the phone made, and a replayed take, accept,
 * start or finish that already landed counts as done. The head technician's
 * hand-out is never saved: sent at once or not at all. Neither is a password.
 */

type AuthListener = (event: string, session: { user: { id: string } } | null) => void;

const mockAuth: { listener: AuthListener | null; userId: string | null } = {
  listener: null,
  userId: null,
};

jest.mock('@/lib/supabase', () => ({
  SESSION_STORAGE_KEY: 'sb-project-auth-token',
  supabase: {
    auth: {
      onAuthStateChange: (listener: AuthListener) => {
        mockAuth.listener = listener;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));
jest.mock('@/features/tasks/api', () => ({
  ...jest.requireActual('@/features/tasks/api'),
  claimTask: jest.fn(),
}));
jest.mock('@/features/board/api', () => ({
  ...jest.requireActual('@/features/board/api'),
  assignProblem: jest.fn(),
}));
jest.mock('@/features/settings/password', () => ({
  ...jest.requireActual('@/features/settings/password'),
  changePassword: jest.fn(),
}));

const ANNA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const CLAIM = { taskId: TASK_ID, cleanerId: ANNA };

const neverAnswers = () => new Promise<never>(() => undefined);

let app: RunningApp | undefined;
let client: QueryClient;
let stopSaving: () => void = () => undefined;

function hear(event: string, userId: string | null): void {
  mockAuth.userId = userId;
  mockAuth.listener?.(event, userId === null ? null : { user: { id: userId } });
}

/** The cache saved as the root's provider saves it once the restore is in. */
function saveAsTheAppDoes(): void {
  stopSaving = persistQueryClientSubscribe({ queryClient: client, ...persistOptions });
}

interface SavedMove {
  mutationKey?: unknown[];
  state: { status: string; isPaused: boolean; variables: unknown };
  meta?: { authorId?: unknown };
}

async function savedMoves(): Promise<SavedMove[]> {
  const saved = JSON.parse((await AsyncStorage.getItem(QUERY_CACHE_KEY)) ?? '{}');
  return saved.clientState?.mutations ?? [];
}

beforeEach(async () => {
  await AsyncStorage.clear();
  onlineManager.setOnline(true);
  mockAuth.listener = null;
  mockAuth.userId = null;
  jest.mocked(claimTask).mockReset();
});

afterEach(() => {
  stopSaving();
  stopSaving = () => undefined;
  signedOutOfQueue();
  app?.stop();
  app = undefined;
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

describe('a move on its way when the app is closed', () => {
  test('a take is saved as waiting, and goes out again after the restart', async () => {
    // Arrange: Anna signed in, the cache saved as the app saves it.
    app = await startApp(settleRealTime);
    client = app.client;
    hear('INITIAL_SESSION', ANNA);
    await settleRealTime();
    saveAsTheAppDoes();
    jest.mocked(claimTask).mockImplementationOnce(neverAnswers);

    // Act: the take sets off; the app is closed before the answer.
    new MutationObserver<unknown, Error, ClaimVariables>(client, {
      mutationKey: taskMutationKeys.claim,
    })
      .mutate(CLAIM)
      .catch(() => undefined);

    // Assert: on disk, waiting, hers.
    await waitFor(async () => expect(await savedMoves()).toHaveLength(1));
    const [take] = await savedMoves();
    expect(take.state).toEqual(
      expect.objectContaining({ status: 'pending', isPaused: true, variables: CLAIM }),
    );
    expect(take.meta?.authorId).toBe(ANNA);

    // Act: the restart.
    stopSaving();
    app.stop();
    jest.mocked(claimTask).mockResolvedValue({ id: TASK_ID } as never);
    app = await startApp(settleRealTime);
    client = app.client;
    hear('INITIAL_SESSION', ANNA);
    await settleRealTime();

    // Assert
    expect(claimTask).toHaveBeenCalledTimes(2);
    expect(claimTask).toHaveBeenLastCalledWith(TASK_ID, ANNA);
  });

  test('the head technician’s hand-out and a password change are never saved', async () => {
    // Arrange
    app = await startApp(settleRealTime);
    client = app.client;
    hear('INITIAL_SESSION', ANNA);
    await settleRealTime();
    saveAsTheAppDoes();
    jest.mocked(assignProblem).mockImplementation(neverAnswers);
    jest.mocked(changePassword).mockImplementation(neverAnswers);
    jest.mocked(claimTask).mockImplementation(neverAnswers);
    const { result: handOut } = await renderHook(() => useAssignProblem(), {
      wrapper: withClient(client),
    });
    const { result: password } = await renderHook(() => useChangePassword(), {
      wrapper: withClient(client),
    });

    // Act: both on their way, then a take — which is saved, so the disk was written after them.
    await act(async () => {
      handOut.current.mutate({
        problemId: 'p1',
        assigneeId: ANNA,
        scheduledDate: '2026-10-09',
        timeFrom: null,
        timeTo: null,
      });
      password.current.mutate({
        email: 'anna@example.com',
        current: 'old-secret',
        next: 'new-secret',
      });
    });
    new MutationObserver<unknown, Error, ClaimVariables>(client, {
      mutationKey: taskMutationKeys.claim,
    })
      .mutate(CLAIM)
      .catch(() => undefined);

    // Assert
    await waitFor(async () => expect(await savedMoves()).toHaveLength(1));
    expect((await savedMoves())[0].mutationKey).toEqual(taskMutationKeys.claim);
    expect(await AsyncStorage.getItem(QUERY_CACHE_KEY)).not.toContain('new-secret');
  });
});
