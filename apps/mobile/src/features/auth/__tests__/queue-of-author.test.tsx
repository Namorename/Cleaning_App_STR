import AsyncStorage from '@react-native-async-storage/async-storage';
import { MutationObserver, onlineManager, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { addMedia, confirmMedia, uploadMediaFile } from '@/features/media/api';
import { mediaMutationKeys, type AttachMediaVariables } from '@/features/media/use-media';
import { claimTask, startTask } from '@/features/tasks/api';
import { taskMutationKeys, useStartTask, type ClaimVariables } from '@/features/tasks/use-tasks';
import { stopWatchingConnection } from '@/lib/online';
import {
  QUERY_CACHE_KEY,
  forgetSavedQueries,
  persistOptions,
  resumeSavedMoves,
} from '@/lib/query-client';
import {
  PARKED_ON_DISK,
  closeApp,
  parkedVariablesOf,
  phoneLeftWith,
  queuedVariables,
  savedMove,
  settleRealTime as settle,
  startApp as startAppWith,
  type RunningApp,
} from '@/testing/phone-queue';
import { signedOutOfQueue } from '@/testing/queue-person';
import { withClient } from '@/testing/restored-cache';

/**
 * The queue of moves belongs to whoever made them (owner's decision of
 * 2026-10-09, MEDIUM-2 of the last review). On a phone handed from one person
 * to another, the moves the first one tapped without signal are never sent
 * with the next one's session: they wait on disk, with no expiry, until their
 * author signs in again. A move restored before anybody's session is known is
 * sent by nobody.
 *
 * Who sent a move is read off the session auth holds when the call is made
 * (`mockAuth.userId`): that is the token the request goes out with.
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
  startTask: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  ...jest.requireActual('@/features/media/api'),
  addMedia: jest.fn(),
  uploadMediaFile: jest.fn(),
  confirmMedia: jest.fn(),
}));

const ANNA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const BORIS = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const ANNAS_TASK = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const BORIS_TASK = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d';
const ANNAS_CLAIM = { taskId: ANNAS_TASK, cleanerId: ANNA };
const BORIS_CLAIM = { taskId: BORIS_TASK, cleanerId: BORIS };
const DAY_MS = 24 * 60 * 60 * 1000;

function photoOf(mediaId: string, taskId: string): AttachMediaVariables {
  return {
    taskId,
    stepId: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
    uri: `file:///documents/task-media/${mediaId}.jpg`,
    mediaId,
    kind: 'photo',
    mimeType: 'image/jpeg',
    byteSize: 200_000,
    width: 1600,
    height: 1200,
    durationSec: null,
    takenAt: '2026-10-09T08:00:00.000Z',
    source: 'camera',
  };
}

const ANNAS_PHOTO = photoOf('a1b2c3d4-0000-4000-8000-000000000001', ANNAS_TASK);
const BORIS_PHOTO = photoOf('a1b2c3d4-0000-4000-8000-000000000002', BORIS_TASK);

/** Anna's take as saved on disk; `null`: saved with no author, as builds before this one saved it. */
const annasClaim = (author: string | null = ANNA) =>
  savedMove(taskMutationKeys.claim, ANNAS_CLAIM, 'task-moves', author ?? undefined);
const annasPhoto = () => savedMove(mediaMutationKeys.attach, ANNAS_PHOTO, 'media-attach', ANNA);

/** Who was signed in when each call went out, by what it moved. */
let sent: { what: string; by: string | null }[] = [];

let app: RunningApp | undefined;
let client: QueryClient;

async function startApp(): Promise<void> {
  app?.stop();
  app = await startAppWith(settle);
  client = app.client;
}

/** Auth says so: who holds the session from now on, and the event the app hears. */
async function hear(event: string, userId: string | null): Promise<void> {
  mockAuth.userId = userId;
  mockAuth.listener?.(event, userId === null ? null : { user: { id: userId } });
  await settle();
}

/** Everything that resumes the queue — the start, signal back, the app in front. */
async function nudgeQueue(): Promise<void> {
  await client.resumePausedMutations();
  await resumeSavedMoves(client);
  await settle();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  onlineManager.setOnline(true);
  mockAuth.listener = null;
  mockAuth.userId = null;
  sent = [];
  jest.mocked(claimTask).mockImplementation(async (taskId: string) => {
    sent.push({ what: taskId, by: mockAuth.userId });
    return { id: taskId } as never;
  });
  jest.mocked(startTask).mockImplementation(async (taskId: string) => {
    sent.push({ what: taskId, by: mockAuth.userId });
    return { id: taskId } as never;
  });
  jest.mocked(addMedia).mockImplementation(async (variables) => {
    sent.push({ what: variables.mediaId, by: mockAuth.userId });
    return { id: variables.mediaId, storage_path: `host-1/${variables.mediaId}.jpg` } as never;
  });
  jest.mocked(uploadMediaFile).mockResolvedValue(undefined as never);
  jest
    .mocked(confirmMedia)
    .mockImplementation(async (mediaId: string) => ({ id: mediaId, uploaded_at: 'now' }) as never);
});

afterEach(() => {
  app?.stop();
  app = undefined;
  signedOutOfQueue();
  stopWatchingConnection();
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

describe('somebody else signs in on her phone', () => {
  test('her queued take is not sent with his session, and waits on disk for her', async () => {
    // Arrange: Anna's take waiting for signal; Boris picks up her phone.
    await phoneLeftWith([annasClaim()], ANNA);
    await startApp();

    // Act
    await hear('SIGNED_IN', BORIS);
    await nudgeQueue();

    // Assert
    expect(sent).toEqual([]);
    expect(queuedVariables(client)).toEqual([]);
    expect(await parkedVariablesOf(ANNA)).toEqual([ANNAS_CLAIM]);
  });

  test('it stays on disk across restarts and past a day, and goes out with her session when she is back', async () => {
    // Arrange: Boris on her phone, then the app closed.
    await phoneLeftWith([annasClaim()], ANNA);
    await startApp();
    await hear('SIGNED_IN', BORIS);
    await closeApp(client);

    // Act: three days later, a restart with Boris's session.
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 3 * DAY_MS);
    await startApp();
    await hear('INITIAL_SESSION', BORIS);
    await nudgeQueue();

    // Assert
    expect(sent).toEqual([]);
    expect(await parkedVariablesOf(ANNA)).toEqual([ANNAS_CLAIM]);

    // Act: another restart; Boris leaves, Anna signs in.
    await closeApp(client);
    await startApp();
    await hear('INITIAL_SESSION', BORIS);
    await hear('SIGNED_OUT', null);
    await hear('SIGNED_IN', ANNA);
    await nudgeQueue();

    // Assert
    expect(sent).toEqual([{ what: ANNAS_TASK, by: ANNA }]);
    expect(await parkedVariablesOf(ANNA)).toEqual([]);
  });

  test('his own take and photo go through while hers wait: her queue holds none of his lines', async () => {
    // Arrange: Anna's take and photo first in their lines.
    await phoneLeftWith([annasClaim(), annasPhoto()], ANNA);
    await startApp();
    await hear('SIGNED_IN', BORIS);

    // Act: Boris takes a cleaning and photographs it.
    const take = new MutationObserver<unknown, Error, ClaimVariables>(client, {
      mutationKey: taskMutationKeys.claim,
    });
    const photo = new MutationObserver<unknown, Error, AttachMediaVariables>(client, {
      mutationKey: mediaMutationKeys.attach,
    });
    take.mutate(BORIS_CLAIM).catch(() => undefined);
    photo.mutate(BORIS_PHOTO).catch(() => undefined);
    await settle();
    await nudgeQueue();

    // Assert
    expect(sent).toHaveLength(2);
    expect(sent).toEqual(
      expect.arrayContaining([
        { what: BORIS_TASK, by: BORIS },
        { what: BORIS_PHOTO.mediaId, by: BORIS },
      ]),
    );
    expect(await parkedVariablesOf(ANNA)).toEqual([ANNAS_CLAIM, ANNAS_PHOTO]);
  });
});

describe('signed out', () => {
  test('signing out parks every queued move; nothing of hers is left to send', async () => {
    // Arrange: Anna's take, restored without signal.
    await phoneLeftWith([annasClaim()], ANNA);
    onlineManager.setOnline(false);
    await startApp();
    await hear('INITIAL_SESSION', ANNA);
    expect(queuedVariables(client)).toEqual([ANNAS_CLAIM]);

    // Act
    await hear('SIGNED_OUT', null);
    onlineManager.setOnline(true);
    await nudgeQueue();

    // Assert
    expect(sent).toEqual([]);
    expect(queuedVariables(client)).toEqual([]);
    expect(await parkedVariablesOf(ANNA)).toEqual([ANNAS_CLAIM]);
  });

  test('with no session known, nothing is resumed and no call goes out', async () => {
    await phoneLeftWith([annasClaim()], ANNA);
    await startApp();

    await hear('INITIAL_SESSION', null);
    await nudgeQueue();

    expect(sent).toEqual([]);
  });

  test('the same person signing out and in again gets her moves back, sent with her session', async () => {
    await phoneLeftWith([annasClaim()], ANNA);
    onlineManager.setOnline(false);
    await startApp();
    await hear('INITIAL_SESSION', ANNA);
    await hear('SIGNED_OUT', null);

    onlineManager.setOnline(true);
    await hear('SIGNED_IN', ANNA);
    await nudgeQueue();

    expect(sent).toEqual([{ what: ANNAS_TASK, by: ANNA }]);
    expect(await parkedVariablesOf(ANNA)).toEqual([]);
  });
});

/**
 * Moves saved by builds before moves had authors (1.1.0, and 1.2.0 at
 * dab5237): they are the stamp's person's, if the cache has a stamp; with no
 * stamp, the first person's signed in after the restore.
 */
describe('a move saved with no author', () => {
  test('belongs to the person the stamp names', async () => {
    await phoneLeftWith([annasClaim(null)], ANNA);
    await startApp();

    await hear('SIGNED_IN', BORIS);
    await nudgeQueue();
    expect(sent).toEqual([]);
    expect(await parkedVariablesOf(ANNA)).toEqual([ANNAS_CLAIM]);

    await hear('SIGNED_OUT', null);
    await hear('SIGNED_IN', ANNA);
    await nudgeQueue();
    expect(sent).toEqual([{ what: ANNAS_TASK, by: ANNA }]);
  });

  test('with no stamp, belongs to the first person signed in after the restore', async () => {
    await phoneLeftWith([annasClaim(null)], null);
    await startApp();

    await hear('SIGNED_IN', BORIS);
    await nudgeQueue();

    expect(sent).toEqual([{ what: ANNAS_TASK, by: BORIS }]);
    expect(await parkedVariablesOf(BORIS)).toEqual([]);
  });
});

describe('the disk', () => {
  test('a move keeps its author when its screen draws again', async () => {
    // Arrange: Anna starts a cleaning without signal.
    await startApp();
    await hear('INITIAL_SESSION', ANNA);
    jest.mocked(startTask).mockRejectedValue(new TypeError('Network request failed'));
    const { result, rerender } = await renderHook(() => useStartTask(), {
      wrapper: withClient(client),
    });

    // Act: the tap, then the screen drawn again while the move waits.
    await act(async () => {
      result.current.mutate(ANNAS_TASK);
      await settle();
    });
    await rerender({});
    await closeApp(client);

    // Assert
    const saved = JSON.parse((await AsyncStorage.getItem(QUERY_CACHE_KEY)) ?? '{}');
    expect(saved.clientState.mutations).toHaveLength(1);
    expect(saved.clientState.mutations[0].meta).toEqual(
      expect.objectContaining({ authorId: ANNA }),
    );
  });

  test('a move both in the saved queue and parked comes back once', async () => {
    // Arrange: the app was closed between parking a move and dropping it from the queue.
    await phoneLeftWith([annasClaim()], ANNA);
    await AsyncStorage.setItem(PARKED_ON_DISK, JSON.stringify({ [ANNA]: [annasClaim()] }));
    await startApp();

    // Act
    await hear('INITIAL_SESSION', ANNA);
    await nudgeQueue();

    // Assert
    expect(sent).toEqual([{ what: ANNAS_TASK, by: ANNA }]);
  });

  test('parked moves outlive «reset saved lists», a new buster and the lists forgotten at sign-out', async () => {
    // Arrange
    await phoneLeftWith([annasClaim()], ANNA);
    await startApp();
    await hear('SIGNED_IN', BORIS);
    expect(await AsyncStorage.getItem(PARKED_ON_DISK)).not.toBeNull();

    // Act
    await forgetSavedQueries();
    await hear('SIGNED_OUT', null);
    await AsyncStorage.setItem(
      QUERY_CACHE_KEY,
      JSON.stringify({ buster: `${persistOptions.buster}-next`, timestamp: Date.now() }),
    );
    await startApp();

    // Assert
    expect(await parkedVariablesOf(ANNA)).toEqual([ANNAS_CLAIM]);
  });
});
