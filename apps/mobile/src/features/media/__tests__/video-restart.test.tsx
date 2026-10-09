import {
  QueryClient,
  dehydrate,
  hydrate,
  onlineManager,
  type DehydratedState,
  type Mutation,
} from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { stepKeys } from '@/features/steps/keys';
import { stopWatchingConnection } from '@/lib/online';
import { createAppQueryClient } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';
import { SIZE, storage } from '@/testing/tus-storage';

import { mediaKeys } from '../keys';
import { rememberLocalMedia } from '../local-store';
import {
  mediaMutationKeys,
  registerMediaMutations,
  useAttachMedia,
  type AttachMediaVariables,
} from '../use-media';

/**
 * A video that was waiting for signal when the app was closed (the two
 * whole-branch reviews of phone-1-2-0, findings 1 and 2). The queue is
 * written to disk as JSON and read back by a client that knows only how to
 * run a media action (`registerMediaMutations`), as the app restores it
 * before any screen asks for anything. Resumed, the video keeps its own line
 * — it does not wait behind the photos — goes up from a new upload when its
 * record never got an address, and refreshes the lists its step shows.
 */

const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const STEP_ID = 'b1c2d3e4-1111-4111-8111-b1c2d3e40001';
const VIDEO_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const PHOTO_ID = 'a1b2c3d4-0000-4000-8000-000000000002';

const mockRpc = jest.fn();
const mockSize = 2 * 6 * 1024 * 1024 + 1000;

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'jwt' } }, error: null }),
      refreshSession: async () => ({ data: { session: { access_token: 'jwt' } }, error: null }),
    },
  },
}));
jest.mock('@/features/chat/api', () => ({ sendMessage: jest.fn() }));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));
jest.mock('../file', () => ({
  discardFile: jest.fn(),
  readFileBytes: jest.fn(async () => new Uint8Array(10)),
  openFileChunks: jest.fn(async () => ({
    size: mockSize,
    read: async (_offset: number, length: number) => new Uint8Array(length),
    close: () => undefined,
  })),
}));

const video: AttachMediaVariables = {
  taskId: TASK_ID,
  stepId: STEP_ID,
  uri: `file:///documents/task-media/${VIDEO_ID}.mp4`,
  mediaId: VIDEO_ID,
  kind: 'video',
  mimeType: 'video/mp4',
  byteSize: SIZE,
  width: null,
  height: null,
  durationSec: 12.3,
  takenAt: '2026-10-09T08:00:00.000Z',
  source: 'camera',
};

const photo: AttachMediaVariables = {
  ...video,
  uri: `file:///documents/task-media/${PHOTO_ID}.jpg`,
  mediaId: PHOTO_ID,
  kind: 'photo',
  mimeType: 'image/jpeg',
  byteSize: 200_000,
  width: 1600,
  height: 1200,
  durationSec: null,
};

/** The row the server registers the video with, its file still to come. */
const videoRow = {
  id: VIDEO_ID,
  task_id: TASK_ID,
  step_id: STEP_ID,
  problem_id: null,
  kind: 'video',
  storage_path: `host-1/${TASK_ID}/${VIDEO_ID}.mp4`,
  mime_type: 'video/mp4',
  duration_sec: 12.3,
  device_taken_at: video.takenAt,
  created_at: video.takenAt,
  uploaded_at: null,
  deleted_at: null,
};

async function letTimePass(ms: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/**
 * The phone before it was closed: a photo, then a video, handed to the queue
 * without signal — both paused, as the app writes them to disk.
 */
async function queueWithoutSignal(): Promise<DehydratedState> {
  const before = createAppQueryClient();
  onlineManager.setOnline(false);
  mockRpc.mockRejectedValue(new TypeError('Network request failed'));
  const { result: photos } = await renderHook(() => useAttachMedia(), {
    wrapper: withClient(before),
  });
  const { result: videos } = await renderHook(() => useAttachMedia('video'), {
    wrapper: withClient(before),
  });
  await act(async () => {
    photos.current.mutate(photo);
    videos.current.mutate(video);
  });
  await letTimePass(5_000);
  stopWatchingConnection();

  const onDisk = JSON.parse(JSON.stringify(dehydrate(before))) as DehydratedState;
  before.clear();
  return onDisk;
}

function attempt(client: QueryClient, mediaId: string): Mutation {
  const found = client
    .getMutationCache()
    .findAll({ mutationKey: mediaMutationKeys.attach })
    .find((mutation) => (mutation.state.variables as AttachMediaVariables).mediaId === mediaId);
  if (found === undefined) {
    throw new Error(`No upload of ${mediaId} in the queue`);
  }
  return found;
}

let after: QueryClient;

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  storage.reset();
  global.fetch = storage.fetch as unknown as typeof fetch;
  onlineManager.setOnline(true);
  // A record written before its upload ever began: no address to resume from.
  await rememberLocalMedia({
    id: VIDEO_ID,
    kind: 'video',
    uri: video.uri,
    mimeType: video.mimeType,
    byteSize: video.byteSize,
    width: null,
    height: null,
    durationSec: video.durationSec,
    takenAt: video.takenAt,
    source: 'camera',
  });
});

afterEach(() => {
  after?.clear();
  stopWatchingConnection();
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

describe('a video restored from disk after a restart', () => {
  async function restoreAndResume(): Promise<jest.SpyInstance> {
    const onDisk = await queueWithoutSignal();
    after = new QueryClient();
    registerMediaMutations(after);
    hydrate(after, onDisk);
    const refreshed = jest.spyOn(after, 'invalidateQueries');
    // The photo's registration never answers: its line is held for as long as the test runs.
    mockRpc.mockImplementation(async (name: string, args: { p_id: string }) => {
      if (args.p_id === PHOTO_ID) {
        return new Promise(() => undefined);
      }
      return name === 'add_task_media'
        ? { data: videoRow, error: null }
        : { data: { ...videoRow, uploaded_at: '2026-10-09T08:30:00.000Z' }, error: null };
    });
    onlineManager.setOnline(true);

    void after.resumePausedMutations();
    await letTimePass(60_000);
    return refreshed;
  }

  test('keeps its own line: it goes up while a photo before it is still on its way', async () => {
    await restoreAndResume();

    expect(attempt(after, VIDEO_ID).options.scope).toEqual({ id: 'media-attach-video' });
    expect(attempt(after, PHOTO_ID).state.status).toBe('pending');
    expect(attempt(after, VIDEO_ID).state.status).toBe('success');
  });

  test('without an address in its record, goes up from a new upload', async () => {
    await restoreAndResume();

    expect(storage.methods()[0]).toBe('POST');
    expect(storage.offset).toBe(SIZE);
  });

  test('refreshes the lists its step shows once it is in', async () => {
    const refreshed = await restoreAndResume();

    expect(refreshed).toHaveBeenCalledWith({ queryKey: mediaKeys.byTask(TASK_ID) });
    expect(refreshed).toHaveBeenCalledWith({ queryKey: stepKeys.byTask(TASK_ID) });
  });
});
