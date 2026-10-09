import { isNetworkError } from '@/lib/network-error';
import {
  AS_USUAL,
  HANG,
  SIZE,
  UPLOAD_URL,
  file,
  runtime,
  setUpTusStorage,
  storage,
  upload,
} from '@/testing/tus-storage';

import {
  TUS_CHUNK_BYTES,
  TUS_PATCH_STALL_MAX_MS,
  TUS_PATCH_STALL_MS,
  TUS_RETRY_DELAYS_MS,
  TUS_SHORT_STALL_MS,
  TusRetryableError,
  tusUpload,
  type TusPresence,
} from '../tus';

/**
 * The resumable upload of a video (docs/tech-plan.md §7.5) on a network that
 * fails it: a connection dropped, a request that hangs, the signal gone, and
 * the app put away while a piece is on its way.
 */

setUpTusStorage();

describe('a dropped connection', () => {
  test('is tried again after a short wait, from the offset the server holds', async () => {
    // Arrange: the second piece reached the server; its answer never came back.
    storage.plan('PATCH', AS_USUAL);
    storage.plan('PATCH', (self) => {
      self.offset = 2 * TUS_CHUNK_BYTES;
      return new TypeError('Network request failed');
    });
    const run = runtime();

    // Act
    await tusUpload(upload(), run);

    // Assert
    expect(run.sleep).toHaveBeenCalledWith(TUS_RETRY_DELAYS_MS[0]);
    expect(storage.methods()).toEqual(['POST', 'PATCH', 'PATCH', 'HEAD', 'PATCH']);
    expect(storage.patches()[2]).toEqual({ offset: 2 * TUS_CHUNK_BYTES, length: 1000 });
  });

  test('ends the attempt after a few tries, as a retryable failure of the network', async () => {
    // Arrange
    storage.fetch.mockRejectedValue(new TypeError('Network request failed'));
    const run = runtime();

    // Act
    const failure = tusUpload(upload(), run);

    // Assert
    await expect(failure).rejects.toBeInstanceOf(TusRetryableError);
    const error: unknown = await failure.catch((reason: unknown) => reason);
    expect(isNetworkError(error)).toBe(true);
    expect(error).toMatchObject({ reason: 'no-answer' });
    expect(jest.mocked(run.sleep).mock.calls).toEqual(TUS_RETRY_DELAYS_MS.map((ms) => [ms]));
    expect(storage.fetch).toHaveBeenCalledTimes(TUS_RETRY_DELAYS_MS.length + 1);
  });

  // The tries are for one blip; a piece through means the blip is over.
  test('gets its tries again once a piece has gone through', async () => {
    // Arrange: before each of the first two pieces, as many failures as there are tries.
    const lost = () => new TypeError('Network request failed');
    for (let piece = 0; piece < 2; piece += 1) {
      TUS_RETRY_DELAYS_MS.forEach(() => storage.plan('PATCH', lost()));
      storage.plan('PATCH', AS_USUAL);
    }
    const run = runtime();

    // Act
    await tusUpload(upload(), run);

    // Assert
    expect(storage.offset).toBe(SIZE);
    expect(jest.mocked(run.sleep).mock.calls).toEqual(
      [...TUS_RETRY_DELAYS_MS, ...TUS_RETRY_DELAYS_MS].map((ms) => [ms]),
    );
  });

  test.each([500, 503, 423, 429, 408])('a busy server (%i) is tried again too', async (status) => {
    storage.plan('PATCH', { status });
    const run = runtime();

    await tusUpload(upload(), run);

    expect(run.sleep).toHaveBeenCalledTimes(1);
    expect(storage.patches()).toHaveLength(4);
  });

  test.each([
    ['POST', 503],
    ['POST', 423],
    ['HEAD', 503],
    ['HEAD', 423],
  ])('a busy server answering %s (%i) is tried again', async (method, status) => {
    if (method === 'HEAD') {
      storage.offset = TUS_CHUNK_BYTES;
    }
    storage.plan(method, { status });
    const run = runtime();

    await tusUpload(upload({ uploadUrl: method === 'HEAD' ? UPLOAD_URL : null }), run);

    expect(run.sleep).toHaveBeenCalledTimes(1);
    expect(storage.offset).toBe(SIZE);
  });

  test('without signal hands back at once, for the queue to wait for it', async () => {
    storage.plan('PATCH', new TypeError('Network request failed'));
    const run = runtime({ isOnline: () => false });

    await expect(tusUpload(upload(), run)).rejects.toBeInstanceOf(TusRetryableError);

    expect(run.sleep).not.toHaveBeenCalled();
  });

  test('a token that could not be had for the network is retried like the request', async () => {
    const video = upload();
    jest
      .mocked(video.accessToken)
      .mockRejectedValueOnce({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' });
    const run = runtime();

    await tusUpload(video, run);

    expect(run.sleep).toHaveBeenCalledTimes(1);
    expect(storage.patches()).toHaveLength(3);
  });
});

// Android's OkHttp under expo/fetch waits for ever by default: a socket gone
// silent in a lift would hold the upload — and every video behind it.
describe('a request that hangs', () => {
  // An uplink too slow for a piece in its time sends it again and again from
  // the start: the attempt ends instead, for the queue to count (attach-retry.ts).
  test('a piece given up on after its time, none of it arrived, ends the attempt as a stall', async () => {
    // Arrange
    jest.useFakeTimers();
    storage.plan('PATCH', HANG);
    const run = runtime();

    // Act
    const failure = tusUpload(upload(), run).catch((reason: unknown) => reason);
    await jest.advanceTimersByTimeAsync(TUS_PATCH_STALL_MS);
    const error = await failure;

    // Assert: the storage was asked where it stands, and holds what it held.
    expect(storage.methods()).toEqual(['POST', 'PATCH', 'HEAD']);
    expect(error).toBeInstanceOf(TusRetryableError);
    expect(error).toMatchObject({ reason: 'stalled', offset: 0 });
    expect(TUS_PATCH_STALL_MS).toBe(120_000);
    expect(file.isClosed()).toBe(true);
  });

  test('a piece given up on after its time, part of it arrived, carries on from there', async () => {
    jest.useFakeTimers();
    storage.plan('PATCH', (self) => {
      self.offset = 1000;
      return HANG;
    });

    const done = tusUpload(upload(), runtime());
    await jest.advanceTimersByTimeAsync(TUS_PATCH_STALL_MS);
    await done;

    expect(storage.methods()).toEqual(['POST', 'PATCH', 'HEAD', 'PATCH', 'PATCH']);
    expect(storage.patches()[1].offset).toBe(1000);
    expect(storage.offset).toBe(SIZE);
  });

  // The queue remembers how often the piece ran out of time; each time it
  // gets twice as long, up to ten minutes — some 80 kbit/s for 6 MiB.
  test.each([
    [0, 120_000],
    [1, 240_000],
    [2, 480_000],
    [3, 600_000],
    [9, 600_000],
  ])('after %i stalls in a row a piece is given %i ms', async (stalls, ms) => {
    jest.useFakeTimers();
    storage.plan('PATCH', HANG);

    const failure = tusUpload(upload({ stalls }), runtime()).catch((reason: unknown) => reason);
    await jest.advanceTimersByTimeAsync(ms - 1);
    expect(storage.methods()).toEqual(['POST', 'PATCH']);
    await jest.advanceTimersByTimeAsync(1);

    await expect(failure).resolves.toMatchObject({ reason: 'stalled' });
    expect(TUS_PATCH_STALL_MAX_MS).toBe(600_000);
  });

  test('a question is given up on sooner', async () => {
    jest.useFakeTimers();
    storage.offset = TUS_CHUNK_BYTES;
    storage.plan('HEAD', HANG);

    const done = tusUpload(upload({ uploadUrl: UPLOAD_URL }), runtime());
    await jest.advanceTimersByTimeAsync(TUS_SHORT_STALL_MS);
    await done;

    expect(storage.methods()).toEqual(['HEAD', 'HEAD', 'PATCH', 'PATCH']);
    expect(TUS_SHORT_STALL_MS).toBeLessThan(TUS_PATCH_STALL_MS);
  });

  test('not before its time', async () => {
    jest.useFakeTimers();
    storage.plan('PATCH', HANG);

    void tusUpload(upload(), runtime()).catch(() => undefined);
    await jest.advanceTimersByTimeAsync(TUS_PATCH_STALL_MS - 1);

    expect(storage.methods()).toEqual(['POST', 'PATCH']);
  });

  test('the signal gone, the request is cut at once and the attempt handed back as the network’s', async () => {
    // Arrange
    let goneOffline: () => void = () => undefined;
    let isOnline = true;
    const run = runtime({
      isOnline: () => isOnline,
      onOffline: jest.fn((listener: () => void) => {
        goneOffline = listener;
        return () => undefined;
      }),
    });
    storage.plan('PATCH', HANG);

    // Act
    const failure = tusUpload(upload(), run).catch((reason: unknown) => reason);
    await new Promise((resolve) => setImmediate(resolve));
    isOnline = false;
    goneOffline();
    const error = await failure;

    // Assert
    expect(error).toBeInstanceOf(TusRetryableError);
    expect(storage.methods()).toEqual(['POST', 'PATCH']);
    expect(run.sleep).not.toHaveBeenCalled();
  });
});

describe('the app put away mid-upload', () => {
  test('does not count against the tries: it waits to be in front and carries on', async () => {
    // Arrange: every request of the first five dies with the app in the background.
    for (let i = 0; i < 5; i += 1) {
      storage.plan('PATCH', new TypeError('The network connection was lost.'));
    }
    const presence: TusPresence = {
      watchAway: () => ({ hasLeft: () => storage.patches().length <= 5, stop: () => undefined }),
      untilInFront: jest.fn(async () => undefined),
    };
    const run = runtime({ presence });

    // Act
    await tusUpload(upload(), run);

    // Assert
    expect(presence.untilInFront).toHaveBeenCalledTimes(5);
    expect(run.sleep).not.toHaveBeenCalled();
    expect(
      storage
        .patches()
        .slice(5)
        .map((patch) => patch.offset),
    ).toEqual([0, TUS_CHUNK_BYTES, 2 * TUS_CHUNK_BYTES]);
  });
});
