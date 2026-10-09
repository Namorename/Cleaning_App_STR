import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { sendMessage } from '@/features/chat/api';
import { stopWatchingConnection } from '@/lib/online';
import { createAppQueryClient } from '@/lib/query-client';
import { serverErrorText } from '@/lib/server-error';
import { withClient } from '@/testing/restored-cache';

import { addMedia, confirmMedia, removeMedia, uploadMediaFile, uploadVideoFile } from '../api';
import {
  ANSWERED_RETRIES,
  ATTACH_RETRIES,
  SILENT_RETRIES,
  STALL_RETRIES,
  attachStalls,
  isNoSignal,
  retryAttach,
} from '../attach-retry';
import type { TaskMedia } from '../schema';
import { TUS_CHUNK_BYTES, TusRefusedError, TusRetryableError, type TusRetryReason } from '../tus';
import { useAttachMedia, useRemoveMedia, type AttachMediaVariables } from '../use-media';

/**
 * How the upload queue tries again (review of video part 2, finding 3; the
 * third pass on video, findings 1 and 2; the fourth, findings 1, 2 and 5).
 * Silence — a request that got no answer at all — marks the queue offline, as
 * the app's other moves do, and waits for signal. Anything the storage
 * answered spends a try: a refusal of three more, a storage busy or lost of
 * eight, a piece that ran out of time without a byte arriving of three. So
 * does silence from the storage while there is signal, four more in a row.
 * Then the upload fails, and its tile offers «Повторить» and «Удалить».
 * Progress starts the counts again; a file that is in or removed lets them go.
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
jest.mock('../local-store', () => ({
  loadLocalMedia: jest.fn(async () => ({})),
  forgetLocalMedia: jest.fn(async () => ({})),
}));
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

  // Under some 84 kbit/s up, a piece cannot arrive even in ten minutes: the
  // step says why, not the general sentence.
  test('stalled until it fails, it says the connection is too slow to send the video', async () => {
    jest.mocked(uploadVideoFile).mockImplementation(async () => {
      throw new TusRetryableError('PATCH moved nothing', 'stalled', { offset: 0 });
    });

    const result = await sendVideo();

    expect(serverErrorText(result.current.error)).toEqual({
      text: 'Связь слишком медленная, чтобы отправить видео. Подключитесь к Wi-Fi или найдите место, где интернет лучше, и нажмите «Повторить загрузку».',
      detail: null,
    });
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

/** The row once the server has the file. */
const confirmedRow = { ...videoRow, uploaded_at: '2026-10-09T08:30:00.000Z' } as TaskMedia;

const MEGABYTE = 1_000_000;

/**
 * Every attempt up to `failures` tells of a megabyte more of the file in
 * storage than the one before it, then fails; the next one goes through.
 */
function failAfterProgress(failures: number, failure: () => Error): void {
  let attempts = 0;
  jest.mocked(uploadVideoFile).mockImplementation(async ({ onProgress }) => {
    attempts += 1;
    onProgress?.(attempts * MEGABYTE, video.byteSize);
    if (attempts <= failures) {
      throw failure();
    }
  });
}

// The server's health answers, so the queue is back online after each
// failure; the upload's own host is out of reach (the fourth pass on video,
// finding 1). Silence with signal on both sides of an attempt counts.
describe('a video whose upload goes unanswered while there is signal', () => {
  beforeEach(() => {
    jest.mocked(addMedia).mockResolvedValue(videoRow);
    jest.mocked(confirmMedia).mockResolvedValue(confirmedRow);
  });

  test.each<TusRetryReason>(['no-answer', 'timed-out'])(
    '(%s) fails after four more attempts in a row',
    async (reason) => {
      // Arrange
      jest.mocked(uploadVideoFile).mockImplementation(async () => {
        throw new TusRetryableError(`Resumable upload POST: ${reason}`, reason);
      });

      // Act
      const result = await sendVideo();

      // Assert
      expect(SILENT_RETRIES).toBe(4);
      expect(uploadVideoFile).toHaveBeenCalledTimes(SILENT_RETRIES + 1);
      expect(result.current.status).toBe('error');
      expect(onlineManager.isOnline()).toBe(true);
    },
  );

  test('an attempt that moved the upload on starts the count again', async () => {
    failAfterProgress(
      9,
      () => new TusRetryableError('PATCH failed: Network request failed', 'no-answer'),
    );

    const result = await sendVideo();

    expect(uploadVideoFile).toHaveBeenCalledTimes(10);
    expect(result.current.status).toBe('success');
  });

  // A stairwell: the signal went while the attempt was on its way.
  test('an attempt cut because the signal went is the network’s, and does not count', async () => {
    let attempts = 0;
    jest.mocked(uploadVideoFile).mockImplementation(async () => {
      attempts += 1;
      if (attempts <= 9) {
        onlineManager.setOnline(false);
        throw new TusRetryableError('PATCH cut: the network was lost', 'no-answer');
      }
    });

    const result = await sendVideo();

    expect(uploadVideoFile).toHaveBeenCalledTimes(10);
    expect(result.current.status).toBe('success');
  });
});

/** The row add_task_media answers a photo with. */
const photoRow = {
  id: 'p1',
  storage_path: 'host-1/task-1/p1.jpg',
  kind: 'photo',
  uploaded_at: null,
} as TaskMedia;

/** Start the photo's upload from its queue and let the clock run. */
async function sendPhoto(variables: AttachMediaVariables = photo) {
  const { result } = await renderHook(() => useAttachMedia(), { wrapper: withClient(client) });
  await act(async () => {
    result.current.mutate(variables);
  });
  await letTimePass();
  return result;
}

// The two whole-branch reviews of phone-1-2-0, finding 3: a photo whose
// request goes unanswered while the server answers its health check meets the
// same silence a video does, and is given up on after the same count — its
// tile then offers «Повторить» instead of a spinner that never ends.
describe('a photo whose upload goes unanswered while there is signal', () => {
  beforeEach(() => {
    jest.mocked(addMedia).mockResolvedValue(photoRow);
    jest.mocked(confirmMedia).mockResolvedValue({ ...photoRow, uploaded_at: 'now' } as TaskMedia);
  });

  test('fails after four more attempts in a row', async () => {
    // Arrange
    jest.mocked(uploadMediaFile).mockRejectedValue(new TypeError('Network request failed'));

    // Act
    const result = await sendPhoto();

    // Assert
    expect(uploadMediaFile).toHaveBeenCalledTimes(SILENT_RETRIES + 1);
    expect(result.current.status).toBe('error');
    expect(onlineManager.isOnline()).toBe(true);
  });

  test('of a chat message whose words go unanswered, fails the same way', async () => {
    // Arrange: the message is said again before its photo, and never arrives.
    jest.mocked(sendMessage).mockRejectedValue(new TypeError('Network request failed'));
    const chatPhoto: AttachMediaVariables = {
      ...photo,
      taskId: undefined,
      stepId: undefined,
      messageId: 'msg-1',
      message: { messageId: 'msg-1', body: '', subject: { kind: 'task', id: 't1' } },
    };

    // Act
    const result = await sendPhoto(chatPhoto);

    // Assert
    expect(sendMessage).toHaveBeenCalledTimes(SILENT_RETRIES + 1);
    expect(result.current.status).toBe('error');
  });

  // A stairwell: the signal went while the photo was on its way.
  test('an attempt cut because the signal went is the network’s, and does not count', async () => {
    let attempts = 0;
    jest.mocked(uploadMediaFile).mockImplementation(async () => {
      attempts += 1;
      if (attempts <= 9) {
        onlineManager.setOnline(false);
        throw new TypeError('Network request failed');
      }
    });

    const result = await sendPhoto();

    expect(uploadMediaFile).toHaveBeenCalledTimes(10);
    expect(result.current.status).toBe('success');
  });
});

// The fourth pass on video, finding 2: progress is what tells a storage that
// trips now and then from one that will never take the file.
describe('the counts of a video’s upload', () => {
  beforeEach(() => {
    jest.mocked(addMedia).mockResolvedValue(videoRow);
    jest.mocked(confirmMedia).mockResolvedValue(confirmedRow);
  });

  test('a storage busy between pieces that go through gets its tries again', async () => {
    failAfterProgress(
      ANSWERED_RETRIES + 3,
      () => new TusRetryableError('PATCH answered 503', 'busy', { status: 503 }),
    );

    const result = await sendVideo();

    expect(uploadVideoFile).toHaveBeenCalledTimes(ANSWERED_RETRIES + 4);
    expect(result.current.status).toBe('success');
  });

  test('a refusal between pieces that go through gets its tries again', async () => {
    failAfterProgress(ATTACH_RETRIES + 3, () => new TusRefusedError(403, 'PATCH answered 403'));

    const result = await sendVideo();

    expect(uploadVideoFile).toHaveBeenCalledTimes(ATTACH_RETRIES + 4);
    expect(result.current.status).toBe('success');
  });

  // Item 7 of the two whole-branch reviews: a storage that forgets the upload
  // after each piece has the video start again from nothing every attempt. Its
  // pieces arrive again and again, but the storage never holds more of the
  // file than it once did: that is not progress, and the tries are spent.
  test('a storage that keeps forgetting the upload gets no tries back for pieces sent again', async () => {
    jest.mocked(uploadVideoFile).mockImplementation(async ({ onProgress }) => {
      onProgress?.(0, video.byteSize);
      onProgress?.(TUS_CHUNK_BYTES, video.byteSize);
      throw new TusRetryableError('Resumable upload keeps losing its place', 'lost-place');
    });

    const result = await sendVideo();

    expect(uploadVideoFile).toHaveBeenCalledTimes(ANSWERED_RETRIES + 1);
    expect(result.current.status).toBe('error');
  });

  test('once the video is in, its counts are let go', async () => {
    // Arrange: two stalls on the first piece, then it goes through.
    const stall = () => new TusRetryableError('PATCH moved nothing', 'stalled', { offset: 0 });
    jest
      .mocked(uploadVideoFile)
      .mockRejectedValueOnce(stall())
      .mockRejectedValueOnce(stall())
      .mockResolvedValue(undefined);

    // Act
    const result = await sendVideo();

    // Assert
    expect(result.current.status).toBe('success');
    expect(attachStalls(video.mediaId)).toBe(0);
  });

  test('once the video is removed, its counts are let go', async () => {
    // Arrange: the queue gave up on it after its stalls.
    jest.mocked(uploadVideoFile).mockImplementation(async () => {
      throw new TusRetryableError('PATCH moved nothing', 'stalled', { offset: 0 });
    });
    jest
      .mocked(removeMedia)
      .mockResolvedValue({ ...videoRow, deleted_at: confirmedRow.uploaded_at });
    await sendVideo();
    expect(attachStalls(video.mediaId)).toBe(STALL_RETRIES + 1);
    const { result: removal } = await renderHook(() => useRemoveMedia(), {
      wrapper: withClient(client),
    });

    // Act: she presses «Удалить».
    await act(async () => {
      removal.current.mutate({ taskId: 't1', mediaId: video.mediaId });
    });
    await letTimePass();

    // Assert
    expect(removal.current.status).toBe('success');
    expect(attachStalls(video.mediaId)).toBe(0);
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
