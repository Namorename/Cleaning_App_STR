import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { stopWatchingConnection } from '@/lib/online';
import { createAppQueryClient } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';

import { addMedia, uploadVideoFile } from '../api';
import { ANSWERED_RETRIES, STALL_RETRIES, isNoSignal, retryAttach } from '../attach-retry';
import type { TaskMedia } from '../schema';
import { TUS_CHUNK_BYTES, TusRetryableError, type TusRetryReason } from '../tus';
import { useAttachMedia, type AttachMediaVariables } from '../use-media';

/**
 * How the upload queue tries again (review of video part 2, finding 3; the
 * third pass on video, findings 1 and 2). Silence — a request that got no
 * answer at all — marks the queue offline, as the app's other moves do, and
 * waits for signal without spending a try. Anything the storage answered
 * spends one: a refusal of three more, a storage busy or lost of eight, a
 * piece that ran out of time without a byte arriving of three. Then the
 * upload fails, and its tile offers «Повторить» and «Удалить».
 */

jest.mock('@/features/chat/api', () => ({ sendMessage: jest.fn() }));
jest.mock('../api', () => ({
  addMedia: jest.fn(),
  confirmMedia: jest.fn(),
  uploadMediaFile: jest.fn(),
  uploadVideoFile: jest.fn(),
  fetchTaskMedia: jest.fn(),
  removeMedia: jest.fn(),
  signedMediaUrls: jest.fn(),
}));
jest.mock('../file', () => ({ discardFile: jest.fn() }));
jest.mock('../local-store', () => ({}));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));

const photo: AttachMediaVariables = {
  taskId: 't1',
  stepId: 's1',
  uri: 'file:///documents/task-media/p1.jpg',
  mediaId: 'p1',
  kind: 'photo',
  mimeType: 'image/jpeg',
  byteSize: 200_000,
  width: 1600,
  height: 1200,
  durationSec: null,
  takenAt: '2026-10-09T08:00:00.000Z',
  source: 'camera',
};

/** Longer than every backoff and every look for the server this file waits for. */
const LONG_ENOUGH_MS = 15 * 60_000;
const STEP_MS = 5_000;

let client: QueryClient;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  onlineManager.setOnline(true);
  // A look for the server finds it.
  global.fetch = jest.fn(async () => ({ ok: true }) as Response);
  client = createAppQueryClient();
});

afterEach(() => {
  client.clear();
  stopWatchingConnection();
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

async function letTimePass(): Promise<void> {
  for (let elapsed = 0; elapsed < LONG_ENOUGH_MS; elapsed += STEP_MS) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(STEP_MS);
    });
  }
}

describe('a failure of the network', () => {
  test.each([
    ['a fetch that reached nothing', new TypeError('Network request failed')],
    [
      'a resumable upload that got no answer',
      new TusRetryableError('PATCH failed: Network request failed', 'no-answer'),
    ],
    [
      'a resumable upload whose question went unanswered in its time',
      new TusRetryableError('HEAD timed out after 30 s', 'timed-out'),
    ],
  ])('%s marks the queue offline and is tried again, whatever came before', (_name, error) => {
    expect(isNoSignal(error)).toBe(true);
    expect(retryAttach(10, error)).toBe(true);
    expect(onlineManager.isOnline()).toBe(false);
  });
});

// The storage answered: there is signal, and waiting for it would loop for ever.
describe('an answer from the storage', () => {
  test.each<[string, TusRetryableError]>([
    ['busy', new TusRetryableError('PATCH answered 503', 'busy', { status: 503 })],
    // A gateway's own words for a busy upstream are an answer too.
    ['busy, in a gateway’s words', new TusRetryableError('POST answered 504: timed out', 'busy')],
    ['lost its place', new TusRetryableError('keeps losing its place', 'lost-place')],
    [
      'a piece that moved nothing',
      new TusRetryableError('moved nothing', 'stalled', { offset: 0 }),
    ],
  ])('%s is not taken for no signal', (_name, error) => {
    expect(isNoSignal(error)).toBe(false);
    retryAttach(0, error);
    expect(onlineManager.isOnline()).toBe(true);
  });
});

/** The row add_task_media answers a video with: its file still to come. */
const videoRow = {
  id: 'v1',
  storage_path: 'host-1/task-1/v1.mp4',
  kind: 'video',
  uploaded_at: null,
} as TaskMedia;

const video: AttachMediaVariables = {
  ...photo,
  uri: 'file:///documents/task-media/v1.mp4',
  mediaId: 'v1',
  kind: 'video',
  mimeType: 'video/mp4',
  byteSize: 21_000_000,
  width: null,
  height: null,
  durationSec: 12.3,
};

/** Start the video's upload from its queue and let the clock run. */
async function sendVideo() {
  const { result } = await renderHook(() => useAttachMedia('video'), {
    wrapper: withClient(client),
  });
  await act(async () => {
    result.current.mutate(video);
  });
  await letTimePass();
  return result;
}

/** How many times in a row the piece had stalled, as each attempt was told. */
function stallsHanded(): (number | undefined)[] {
  return jest.mocked(uploadVideoFile).mock.calls.map(([upload]) => upload.stalls);
}

describe('a video the storage keeps answering', () => {
  beforeEach(() => {
    jest.mocked(addMedia).mockResolvedValue(videoRow);
  });

  test.each<[TusRetryReason, number | undefined]>([
    ['busy', 503],
    ['lost-place', undefined],
  ])(
    '(%s) fails after its eight more tries, without waiting for signal',
    async (reason, status) => {
      // Arrange
      jest.mocked(uploadVideoFile).mockImplementation(async () => {
        throw new TusRetryableError(`Resumable upload: ${reason}`, reason, { status });
      });

      // Act
      const result = await sendVideo();

      // Assert
      expect(ANSWERED_RETRIES).toBe(8);
      expect(uploadVideoFile).toHaveBeenCalledTimes(ANSWERED_RETRIES + 1);
      expect(result.current.status).toBe('error');
      expect(onlineManager.isOnline()).toBe(true);
    },
  );

  test('stalled on the same piece fails after three more tries, each given longer', async () => {
    jest.mocked(uploadVideoFile).mockImplementation(async () => {
      throw new TusRetryableError('PATCH moved nothing', 'stalled', { offset: 0 });
    });

    const result = await sendVideo();

    expect(STALL_RETRIES).toBe(3);
    expect(stallsHanded()).toEqual([0, 1, 2, 3]);
    expect(result.current.status).toBe('error');
    expect(onlineManager.isOnline()).toBe(true);
  });

  // A stall at a later piece means the earlier one went through meanwhile.
  test('stalled on a later piece starts the count again', async () => {
    const offsets = [0, 0, TUS_CHUNK_BYTES, TUS_CHUNK_BYTES, TUS_CHUNK_BYTES, TUS_CHUNK_BYTES];
    offsets.forEach((offset) => {
      jest.mocked(uploadVideoFile).mockImplementationOnce(async () => {
        throw new TusRetryableError('PATCH moved nothing', 'stalled', { offset });
      });
    });

    const result = await sendVideo();

    expect(stallsHanded()).toEqual([0, 1, 2, 1, 2, 3]);
    expect(result.current.status).toBe('error');
  });

  test('tried again from its tile, a stalled video starts afresh', async () => {
    // Arrange: the queue gave up on it.
    jest.mocked(uploadVideoFile).mockImplementation(async () => {
      throw new TusRetryableError('PATCH moved nothing', 'stalled', { offset: 0 });
    });
    const result = await sendVideo();
    jest.mocked(uploadVideoFile).mockClear();

    // Act: she presses «Повторить».
    await act(async () => {
      result.current.mutate(video);
    });
    await letTimePass();

    // Assert
    expect(stallsHanded()).toEqual([0, 1, 2, 3]);
  });
});

test('an outage spends no try: a refusal after it still gets its three more', async () => {
  // Arrange: four failures of the network, then refusals.
  const refusal = { message: 'too large', hint: 'serverErrors.mediaTooLarge', code: 'P0001' };
  const attach = jest.mocked(addMedia);
  for (let i = 0; i < 4; i += 1) {
    attach.mockRejectedValueOnce(new TypeError('Network request failed'));
  }
  attach.mockRejectedValue(refusal);
  const { result } = await renderHook(() => useAttachMedia(), { wrapper: withClient(client) });

  // Act
  await act(async () => {
    result.current.mutate(photo);
  });
  await letTimePass();

  // Assert: four outages, then the refusal and its three more tries.
  expect(attach).toHaveBeenCalledTimes(8);
  expect(result.current.error).toBe(refusal);
});

test('tried again from its tile, an upload starts its count afresh', async () => {
  // Arrange: refused four times — the queue gave up.
  const refusal = { message: 'try later', code: 'P0001' };
  const attach = jest.mocked(addMedia);
  attach.mockRejectedValue(refusal);
  const { result } = await renderHook(() => useAttachMedia(), { wrapper: withClient(client) });
  await act(async () => {
    result.current.mutate(photo);
  });
  await letTimePass();
  expect(attach).toHaveBeenCalledTimes(4);

  // Act: she presses «Повторить загрузку».
  await act(async () => {
    result.current.mutate(photo);
  });
  await letTimePass();

  // Assert
  expect(attach).toHaveBeenCalledTimes(8);
});
