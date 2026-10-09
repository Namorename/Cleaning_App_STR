import {
  AS_USUAL,
  HANG,
  SIZE,
  UPLOAD_URL,
  runtime,
  setUpTusStorage,
  storage,
  upload,
  type Planned,
} from '@/testing/tus-storage';

import {
  TUS_CHUNK_BYTES,
  TUS_PATCH_STALL_MS,
  TUS_RETRY_DELAYS_MS,
  TUS_SHORT_STALL_MS,
  TusRefusedError,
  TusRetryableError,
  tusUpload,
} from '../tus';

/**
 * The resumable upload of a video (docs/tech-plan.md §7.5), one request at a
 * time: the limit and the watch on the signal held until its answer is read
 * through, and let go after; and the reason an attempt hands back with, which
 * the queue reads (attach-retry.ts).
 */

setUpTusStorage();

/** A runtime that counts the signal's listeners it hands out and takes back. */
function countedRuntime() {
  const unsubscribes: jest.Mock[] = [];
  const run = runtime({
    onOffline: jest.fn(() => {
      const unsubscribe = jest.fn();
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    }),
  });
  const allLetGo = () => unsubscribes.every((unsubscribe) => unsubscribe.mock.calls.length === 1);
  return { run, unsubscribes, allLetGo };
}

// A request's limit holds until its answer is read through: the words of a
// refusal come after its headers, and a body that never finishes would hold
// the upload where a silent socket no longer can.
describe('the timers and listeners of a request', () => {
  test('a refusal whose words never arrive is given up on after the short limit, and still refused', async () => {
    // Arrange
    jest.useFakeTimers();
    storage.plan('PATCH', { status: 403, isBodyStuck: true });
    let isSettled = false;

    // Act
    const failure = tusUpload(upload(), runtime()).catch((reason: unknown) => reason);
    void failure.then(() => {
      isSettled = true;
    });
    await jest.advanceTimersByTimeAsync(TUS_SHORT_STALL_MS - 1);
    const settledEarly = isSettled;
    await jest.advanceTimersByTimeAsync(1);

    // Assert
    expect(settledEarly).toBe(false);
    const error = await failure;
    expect(error).toBeInstanceOf(TusRefusedError);
    expect(error).toMatchObject({ status: 403 });
  });

  // Supabase tells of a token past its time in a 400's words: words that
  // never came may have said just that (the fourth pass on video, finding 3).
  test('a 400 whose words never arrive is not waited on, and is sent again once with a fresh token', async () => {
    // Arrange
    jest.useFakeTimers();
    storage.plan('PATCH', { status: 400, isBodyStuck: true });
    const video = upload();

    // Act
    const done = tusUpload(video, runtime());
    await jest.advanceTimersByTimeAsync(TUS_SHORT_STALL_MS);
    await done;

    // Assert
    expect(video.accessToken).toHaveBeenCalledWith(true);
    const [cut, again] = storage.calls.filter((call) => call.method === 'PATCH');
    expect(again.headers.Authorization).toMatch(/^Bearer fresh-/);
    expect(again.headers['Upload-Offset']).toBe(cut.headers['Upload-Offset']);
    expect(storage.offset).toBe(SIZE);
  });

  test('a 400 whose words never arrive after the fresh token either is a refusal, not a loop', async () => {
    jest.useFakeTimers();
    storage.plan('PATCH', { status: 400, isBodyStuck: true });
    storage.plan('PATCH', { status: 400, isBodyStuck: true });
    const video = upload();

    const failure = tusUpload(video, runtime()).catch((reason: unknown) => reason);
    await jest.advanceTimersByTimeAsync(2 * TUS_SHORT_STALL_MS);

    await expect(failure).resolves.toBeInstanceOf(TusRefusedError);
    await expect(failure).resolves.toMatchObject({ status: 400 });
    expect(jest.mocked(video.accessToken).mock.calls.filter(([refresh]) => refresh)).toHaveLength(
      1,
    );
  });

  // The headers came; the connection did not hold for the words. Nothing was
  // said that can be read, and a 503 cut so is not the storage being busy.
  test('the signal lost while a refusal’s words are on their way: no answer, not busy', async () => {
    // Arrange
    let goneOffline: () => void = () => undefined;
    const run = runtime({
      isOnline: () => false,
      onOffline: jest.fn((listener: () => void) => {
        goneOffline = listener;
        return () => {
          goneOffline = () => undefined;
        };
      }),
    });
    storage.plan('PATCH', { status: 503, isBodyStuck: true });

    // Act
    const failure = tusUpload(upload(), run).catch((reason: unknown) => reason);
    await new Promise((resolve) => setImmediate(resolve));
    goneOffline();

    // Assert: the attempt hands back at once, for the queue to wait for signal.
    const error = await failure;
    expect(error).toBeInstanceOf(TusRetryableError);
    expect(error).toMatchObject({ reason: 'no-answer' });
  });

  test('a refusal whose words fail on their way while there is signal: no answer, not busy', async () => {
    TUS_RETRY_DELAYS_MS.forEach(() => storage.plan('POST', { status: 503, isBodyLost: true }));
    storage.plan('POST', { status: 503, isBodyLost: true });

    const failure = tusUpload(upload(), runtime());

    await expect(failure).rejects.toBeInstanceOf(TusRetryableError);
    await expect(failure).rejects.toMatchObject({ reason: 'no-answer' });
  });

  test('a 400 whose words fail on their way is no answer either, not a refusal', async () => {
    storage.plan('PATCH', { status: 400, isBodyLost: true });
    const run = runtime();

    await tusUpload(upload(), run);

    expect(run.sleep).toHaveBeenCalledWith(TUS_RETRY_DELAYS_MS[0]);
    expect(storage.offset).toBe(SIZE);
  });

  test('after an upload that went through, no timer is left and every listener is let go', async () => {
    jest.useFakeTimers();
    const { run, unsubscribes, allLetGo } = countedRuntime();

    await tusUpload(upload(), run);

    expect(unsubscribes).toHaveLength(storage.calls.length);
    expect(allLetGo()).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each<[string, Planned]>([
    ['refused', { status: 403, body: '{"message":"Access denied"}' }],
    ['refused, its words never arriving', { status: 403, isBodyStuck: true }],
    ['cut for time with nothing arrived', HANG],
    ['failed on the way', new TypeError('Network request failed')],
  ])('after an upload %s, no timer is left and every listener is let go', async (_name, reply) => {
    // Arrange
    jest.useFakeTimers();
    storage.plan('PATCH', reply);
    for (let i = 0; i < TUS_RETRY_DELAYS_MS.length; i += 1) {
      storage.plan('PATCH', reply instanceof Error ? reply : AS_USUAL);
    }
    const { run, unsubscribes, allLetGo } = countedRuntime();

    // Act
    const failure = tusUpload(upload(), run).catch((reason: unknown) => reason);
    await jest.advanceTimersByTimeAsync(TUS_PATCH_STALL_MS + TUS_SHORT_STALL_MS);
    await failure;

    // Assert
    expect(unsubscribes).toHaveLength(storage.calls.length);
    expect(allLetGo()).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});

// The queue waits for signal only on silence; anything the storage answered
// spends a try (attach-retry.ts). The reason is told where the error is made.
describe('why an attempt handed back', () => {
  test('a request that reached nothing: no answer', async () => {
    storage.fetch.mockRejectedValue(new TypeError('Network request failed'));

    await expect(tusUpload(upload(), runtime())).rejects.toMatchObject({ reason: 'no-answer' });
  });

  test('a request cut because the signal went: no answer', async () => {
    let goneOffline: () => void = () => undefined;
    const run = runtime({
      isOnline: () => false,
      onOffline: jest.fn((listener: () => void) => {
        goneOffline = listener;
        return () => undefined;
      }),
    });
    storage.plan('PATCH', HANG);

    const failure = tusUpload(upload(), run).catch((reason: unknown) => reason);
    await new Promise((resolve) => setImmediate(resolve));
    goneOffline();

    await expect(failure).resolves.toMatchObject({ reason: 'no-answer' });
  });

  test('a session token the network kept away: no answer', async () => {
    const video = upload();
    jest
      .mocked(video.accessToken)
      .mockRejectedValue({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' });

    await expect(tusUpload(video, runtime())).rejects.toMatchObject({ reason: 'no-answer' });
  });

  test('a question that got no answer in its time: timed out', async () => {
    jest.useFakeTimers();
    storage.offset = TUS_CHUNK_BYTES;
    TUS_RETRY_DELAYS_MS.forEach(() => storage.plan('HEAD', HANG));
    storage.plan('HEAD', HANG);

    const failure = tusUpload(upload({ uploadUrl: UPLOAD_URL }), runtime()).catch(
      (reason: unknown) => reason,
    );
    await jest.advanceTimersByTimeAsync((TUS_RETRY_DELAYS_MS.length + 1) * TUS_SHORT_STALL_MS);

    await expect(failure).resolves.toMatchObject({ reason: 'timed-out' });
  });

  test.each([500, 503, 423, 429, 408])(
    'a storage that kept answering it is busy (%i): busy, with its status',
    async (status) => {
      TUS_RETRY_DELAYS_MS.forEach(() => storage.plan('POST', { status }));
      storage.plan('POST', { status });

      const failure = tusUpload(upload(), runtime());

      await expect(failure).rejects.toBeInstanceOf(TusRetryableError);
      await expect(failure).rejects.toMatchObject({ reason: 'busy', status });
    },
  );

  test('a storage that kept losing its place: lost place', async () => {
    for (let i = 0; i < 4; i += 1) {
      storage.plan('PATCH', { status: 409 });
    }

    await expect(tusUpload(upload(), runtime())).rejects.toMatchObject({ reason: 'lost-place' });
  });

  test('a storage that kept answering a question without its offset: lost place', async () => {
    storage.offset = TUS_CHUNK_BYTES;
    TUS_RETRY_DELAYS_MS.forEach(() => storage.plan('HEAD', { status: 200 }));
    storage.plan('HEAD', { status: 200 });

    await expect(tusUpload(upload({ uploadUrl: UPLOAD_URL }), runtime())).rejects.toMatchObject({
      reason: 'lost-place',
    });
  });
});
