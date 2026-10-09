import {
  SECOND_URL,
  SIZE,
  UPLOAD_URL,
  file,
  runtime,
  setUpTusStorage,
  storage,
  upload,
} from '@/testing/tus-storage';

import { TUS_CHUNK_BYTES, TusRefusedError, TusRetryableError, tusUpload } from '../tus';

/**
 * The resumable upload of a video (docs/tech-plan.md §7.5) carried on from
 * where the storage stands: an upload kept from before, a file it already
 * holds, a place it lost, a session that expired, and a refusal.
 */

setUpTusStorage();

describe('a stored upload', () => {
  test('carries on from where the server says it stopped', async () => {
    // Arrange: the first piece arrived before the network dropped.
    storage.offset = TUS_CHUNK_BYTES;
    const video = upload({ uploadUrl: UPLOAD_URL });

    // Act
    await tusUpload(video, runtime());

    // Assert
    expect(storage.methods()).toEqual(['HEAD', 'PATCH', 'PATCH']);
    expect(storage.calls[0].url).toBe(UPLOAD_URL);
    expect(storage.patches()[0]).toEqual({ offset: TUS_CHUNK_BYTES, length: TUS_CHUNK_BYTES });
    expect(video.onProgress.mock.calls[0]).toEqual([TUS_CHUNK_BYTES, SIZE]);
  });

  // A piece cut in the middle leaves the storage holding a part of it.
  test('carries on from an offset that is not a whole number of pieces', async () => {
    storage.offset = 1000;

    await tusUpload(upload({ uploadUrl: UPLOAD_URL }), runtime());

    expect(storage.patches()).toEqual([
      { offset: 1000, length: TUS_CHUNK_BYTES },
      { offset: 1000 + TUS_CHUNK_BYTES, length: TUS_CHUNK_BYTES },
    ]);
    expect(storage.offset).toBe(SIZE);
  });

  test('that the server already holds whole is done without sending a byte', async () => {
    storage.offset = SIZE;
    const video = upload({ uploadUrl: UPLOAD_URL });

    await tusUpload(video, runtime());

    expect(storage.methods()).toEqual(['HEAD']);
    expect(file.reads).toEqual([]);
    expect(video.onProgress).toHaveBeenLastCalledWith(SIZE, SIZE);
  });

  test.each([404, 410])(
    'whose address expired (%i) starts over with a new upload',
    async (status) => {
      // Arrange: an address lives 24 hours.
      storage.plan('HEAD', { status });
      const video = upload({ uploadUrl: UPLOAD_URL });

      // Act
      await tusUpload(video, runtime());

      // Assert
      expect(storage.methods()).toEqual(['HEAD', 'POST', 'PATCH', 'PATCH', 'PATCH']);
      expect(storage.patches()[0].offset).toBe(0);
      expect(jest.mocked(video.saveUploadUrl).mock.calls).toEqual([[null], [UPLOAD_URL]]);
    },
  );

  // An address kept from an earlier attempt may belong to an upload the
  // storage no longer lets this session touch: one fresh start, not a failure.
  test('refused at its first question is forgotten once, and a new upload made', async () => {
    storage.offset = TUS_CHUNK_BYTES;
    storage.plan('HEAD', { status: 403, body: '{"message":"Access denied"}' });
    const video = upload({ uploadUrl: UPLOAD_URL });

    await tusUpload(video, runtime());

    expect(storage.methods()).toEqual(['HEAD', 'POST', 'PATCH', 'PATCH', 'PATCH']);
    expect(jest.mocked(video.saveUploadUrl).mock.calls).toEqual([[null], [UPLOAD_URL]]);
  });

  test('refused again on the new upload is a refusal, not a loop', async () => {
    storage.offset = TUS_CHUNK_BYTES;
    storage.plan('HEAD', { status: 403 });
    storage.plan('PATCH', { status: 403, body: '{"message":"Access denied"}' });

    await expect(tusUpload(upload({ uploadUrl: UPLOAD_URL }), runtime())).rejects.toMatchObject({
      status: 403,
    });

    expect(storage.methods()).toEqual(['HEAD', 'POST', 'PATCH']);
  });

  test('without an offset in the storage’s answer is asked again', async () => {
    storage.offset = TUS_CHUNK_BYTES;
    storage.plan('HEAD', { status: 200 });
    const run = runtime();

    await tusUpload(upload({ uploadUrl: UPLOAD_URL }), run);

    expect(run.sleep).toHaveBeenCalledTimes(1);
    expect(storage.methods()).toEqual(['HEAD', 'HEAD', 'PATCH', 'PATCH']);
  });
});

describe('a file the storage already has', () => {
  test('counts as uploaded when the creation is answered 409', async () => {
    storage.plan('POST', { status: 409, body: 'The resource already exists' });

    await expect(tusUpload(upload(), runtime())).resolves.toBeUndefined();

    expect(storage.methods()).toEqual(['POST']);
  });

  test('and when the refusal says so in its words', async () => {
    storage.plan('POST', {
      status: 400,
      body: JSON.stringify({ statusCode: '409', message: 'The resource already exists' }),
    });

    await expect(tusUpload(upload(), runtime())).resolves.toBeUndefined();
  });
});

test('a piece answered 409 asks for the offset and carries on from the server’s', async () => {
  // Arrange: the piece got through, its answer did not, and the retry was refused.
  storage.plan('PATCH', (self) => {
    self.offset = TUS_CHUNK_BYTES;
    return { status: 409 };
  });

  // Act
  await tusUpload(upload(), runtime());

  // Assert
  expect(storage.methods()).toEqual(['POST', 'PATCH', 'HEAD', 'PATCH', 'PATCH']);
  expect(storage.patches().slice(1)).toEqual([
    { offset: TUS_CHUNK_BYTES, length: TUS_CHUNK_BYTES },
    { offset: 2 * TUS_CHUNK_BYTES, length: 1000 },
  ]);
});

test('a piece whose address expired (404) starts the upload over', async () => {
  storage.plan('PATCH', (self) => {
    self.offset = null;
    return { status: 404 };
  });
  const video = upload();

  await tusUpload(video, runtime());

  expect(storage.methods()).toEqual(['POST', 'PATCH', 'POST', 'PATCH', 'PATCH', 'PATCH']);
  expect(jest.mocked(video.saveUploadUrl).mock.calls).toEqual([[UPLOAD_URL], [null], [SECOND_URL]]);
  expect(storage.offset).toBe(SIZE);
});

describe('a storage that loses its place', () => {
  test('a piece answered 2xx without moving the offset is asked about, not sent forever', async () => {
    storage.plan('PATCH', { status: 204, headers: { 'Upload-Offset': '0' } });

    await tusUpload(upload(), runtime());

    expect(storage.methods()).toEqual(['POST', 'PATCH', 'HEAD', 'PATCH', 'PATCH', 'PATCH']);
  });

  test('too many detours in a row end the attempt, for the queue to try later', async () => {
    for (let i = 0; i < 4; i += 1) {
      storage.plan('PATCH', { status: 204, headers: { 'Upload-Offset': '0' } });
    }

    const failure = tusUpload(upload(), runtime());

    await expect(failure).rejects.toBeInstanceOf(TusRetryableError);
    expect(storage.patches()).toHaveLength(4);
  });

  test('conflicts in a row end it too', async () => {
    for (let i = 0; i < 4; i += 1) {
      storage.plan('PATCH', { status: 409 });
    }

    await expect(tusUpload(upload(), runtime())).rejects.toThrow(/losing its place/);

    expect(storage.patches()).toHaveLength(4);
  });
});

describe('an expired session', () => {
  test.each(['POST', 'HEAD', 'PATCH'])(
    'answered 401 to %s is refreshed once and the request made again',
    async (method) => {
      // Arrange
      if (method === 'HEAD') {
        storage.offset = TUS_CHUNK_BYTES;
      }
      storage.plan(method, { status: 401 });
      const video = upload({ uploadUrl: method === 'HEAD' ? UPLOAD_URL : null });

      // Act
      await tusUpload(video, runtime());

      // Assert
      expect(video.accessToken).toHaveBeenCalledWith(true);
      const [refused, again] = storage.calls.filter((call) => call.method === method);
      expect(again.headers.Authorization).toMatch(/^Bearer fresh-/);
      expect(again.headers['Upload-Offset']).toBe(refused.headers['Upload-Offset']);
      expect(storage.offset).toBe(SIZE);
    },
  );

  // Supabase Storage answers a token past its time with 400 and the JWT's words.
  test('answered 400 with an expired JWT is refreshed once too', async () => {
    storage.plan('PATCH', {
      status: 400,
      body: JSON.stringify({
        statusCode: '400',
        error: 'InvalidJWT',
        message: '"exp" claim timestamp check failed',
      }),
    });
    const video = upload();

    await tusUpload(video, runtime());

    expect(video.accessToken).toHaveBeenCalledWith(true);
    expect(storage.offset).toBe(SIZE);
  });

  test('refused again after the refresh is a refusal, not a loop', async () => {
    storage.plan('PATCH', { status: 401 });
    storage.plan('PATCH', { status: 401, body: '{"message":"jwt expired"}' });
    const video = upload();

    const failure = tusUpload(video, runtime());

    await expect(failure).rejects.toBeInstanceOf(TusRefusedError);
    await expect(failure).rejects.toMatchObject({ status: 401 });
    expect(jest.mocked(video.accessToken).mock.calls.filter(([refresh]) => refresh)).toHaveLength(
      1,
    );
  });
});

test.each([
  [400, 'Invalid Upload-Metadata'],
  [403, 'new row violates row-level security policy'],
  [413, 'The object exceeded the maximum allowed size'],
])(
  'a refusal (%i) is not tried again, and keeps the storage’s words for the log',
  async (status, message) => {
    // Arrange
    storage.plan('PATCH', {
      status,
      body: JSON.stringify({ statusCode: String(status), message }),
    });
    const run = runtime();

    // Act
    const failure = tusUpload(upload(), run);

    // Assert
    await expect(failure).rejects.toBeInstanceOf(TusRefusedError);
    await expect(failure).rejects.toMatchObject({
      status,
      message: expect.stringContaining(message),
    });
    expect(storage.methods()).toEqual(['POST', 'PATCH']);
    expect(run.sleep).not.toHaveBeenCalled();
    expect(file.isClosed()).toBe(true);
  },
);
