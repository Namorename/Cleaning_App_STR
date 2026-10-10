import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersistedClient } from '@tanstack/react-query-persist-client';

import { mediaKeys } from '@/features/media/keys';
import { storedMediaPathsOfMoves, withStoredMediaPaths } from '@/features/media/stored-paths';
import { mediaMutationKeys } from '@/features/media/use-media';
import { problemMutationKeys } from '@/features/problems/keys';
import { taskMutationKeys } from '@/features/tasks/use-tasks';

import { QUERY_CACHE_KEY, persistOptions, queryPersister } from '../query-client';

/**
 * The upload queue on disk, moved to the places of its files (iPhone risk 1,
 * docs/ios-first-device-checklist.md). A build before this one saved each
 * queued upload with the file's full path, inside the folder of the install it
 * ran in; a new build on an iPhone may run in another. Restored as it was, the
 * upload would read a path that is not there and never go — so the restore
 * hands every queued file on by its place in the documents, nothing else
 * touched, and the queue is written back that way.
 */

const OLD = 'file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/task-media/';
const CACHE = 'file:///var/mobile/Containers/Data/Application/OLD-UUID/Library/Caches/a.jpg';

const photo = {
  mediaId: 'm1',
  taskId: 't1',
  stepId: 's1',
  kind: 'photo',
  mimeType: 'image/jpeg',
  byteSize: 100,
  width: 1600,
  height: 1200,
  durationSec: null,
  takenAt: '2026-10-10T10:00:00.000Z',
  source: 'camera',
};
const record = {
  id: 'p1',
  kind: 'photo',
  mimeType: 'image/jpeg',
  byteSize: 100,
  width: 1600,
  height: 1200,
  durationSec: null,
  takenAt: '2026-10-10T10:00:00.000Z',
  source: 'camera',
  uploadUrl: null,
};
const claim = { taskId: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b', cleanerId: 'u1' };

function savedMove(mutationKey: readonly unknown[], variables: unknown) {
  return {
    mutationKey,
    meta: { authorId: 'u1' },
    scope: { id: 'media-attach' },
    state: {
      context: undefined,
      data: undefined,
      error: null,
      failureCount: 0,
      failureReason: null,
      isPaused: true,
      status: 'pending',
      variables,
      submittedAt: 1_760_000_000_000,
    },
  };
}

function savedClient(): PersistedClient {
  return {
    buster: persistOptions.buster,
    timestamp: Date.now(),
    clientState: {
      mutations: [
        savedMove(mediaMutationKeys.attach, { ...photo, uri: `${OLD}m1.jpg` }),
        savedMove(problemMutationKeys.report, {
          id: 'r1',
          photos: [{ ...record, uri: `${OLD}p1.jpg` }],
        }),
        savedMove(taskMutationKeys.claim, claim),
      ],
      queries: [
        {
          queryKey: mediaKeys.local,
          queryHash: JSON.stringify(mediaKeys.local),
          state: { data: { p1: { ...record, uri: `${OLD}p1.jpg` } }, status: 'success' },
        },
      ],
    },
  } as unknown as PersistedClient;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('a queued upload saved with a full path comes back by its place in the documents', async () => {
  // Arrange: what the build before saved.
  await AsyncStorage.setItem(QUERY_CACHE_KEY, JSON.stringify(savedClient()));

  // Act: the restore at the next start.
  const restored = await queryPersister.restoreClient();

  // Assert: the files' places, and nothing else changed.
  const expected = savedClient();
  const [attach, report] = expected.clientState.mutations;
  (attach.state.variables as { uri: string }).uri = 'task-media/m1.jpg';
  (report.state.variables as { photos: { uri: string }[] }).photos[0].uri = 'task-media/p1.jpg';
  (expected.clientState.queries[0].state.data as Record<string, { uri: string }>).p1.uri =
    'task-media/p1.jpg';
  expect(restored?.clientState).toEqual(expected.clientState);
});

test('the ledger of kept files is moved too, at the same start', async () => {
  await AsyncStorage.setItem(QUERY_CACHE_KEY, JSON.stringify(savedClient()));
  await AsyncStorage.setItem(
    'str-ops.media-local',
    JSON.stringify({ p1: { ...record, uri: `${OLD}p1.jpg` } }),
  );

  await queryPersister.restoreClient();

  const ledger = JSON.parse((await AsyncStorage.getItem('str-ops.media-local')) ?? '{}');
  expect(ledger.p1.uri).toBe('task-media/p1.jpg');
});

test('nothing saved restores as nothing', async () => {
  await expect(queryPersister.restoreClient()).resolves.toBeUndefined();
});

describe('what is not a kept file is handed on as it was', () => {
  test('a capture still in the cache, and a move with no file', () => {
    const moves = [
      savedMove(mediaMutationKeys.attach, { ...photo, uri: CACHE }),
      savedMove(taskMutationKeys.claim, claim),
    ];

    expect(storedMediaPathsOfMoves(moves as never)).toEqual(moves);
  });

  test('a move whose variables are not an object, and photos that are not a list', () => {
    const moves = [
      savedMove(['settings', 'language'], 'cs'),
      savedMove(problemMutationKeys.report, { id: 'r1', photos: 'none' }),
      { mutationKey: ['odd'] },
    ];

    expect(storedMediaPathsOfMoves(moves as never)).toEqual(moves);
  });

  test('a saved cache of another shape', () => {
    const odd = { buster: 'x', timestamp: 1, clientState: { mutations: 'none' } };

    expect(withStoredMediaPaths(odd as never)).toEqual(odd);
    expect(withStoredMediaPaths(undefined)).toBeUndefined();
  });
});

test('the same move from the queue and from the parked store reads as one', () => {
  // Parked by the old build with the full path, saved in the queue the same way:
  // both are moved by one rule, so the identity of the move (lib/parked-moves.ts)
  // still finds the copy found twice.
  const parked = storedMediaPathsOfMoves([
    savedMove(mediaMutationKeys.attach, { ...photo, uri: `${OLD}m1.jpg` }),
  ] as never);
  const queued = withStoredMediaPaths(savedClient())?.clientState.mutations.slice(0, 1);

  expect(parked).toEqual(queued);
});
