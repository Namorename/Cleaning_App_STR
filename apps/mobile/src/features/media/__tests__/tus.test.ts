import { isNetworkError } from '@/lib/network-error';

import {
  TUS_CHUNK_BYTES,
  TUS_PATCH_STALL_MAX_MS,
  TUS_PATCH_STALL_MS,
  TUS_RETRY_DELAYS_MS,
  TUS_SHORT_STALL_MS,
  TusFileError,
  TusRefusedError,
  TusRetryableError,
  tusUpload,
  type TusPresence,
  type TusRuntime,
  type TusSource,
  type TusUpload,
} from '../tus';

/**
 * The resumable upload of a video (docs/tech-plan.md §7.5) against a storage
 * that keeps its offset the way Supabase's does: created by POST, asked by
 * HEAD, fed by PATCH in pieces of exactly 6 MB. The storage here is strict
 * the way a TUS server is: it refuses a request without the protocol's
 * version (412), a piece of the wrong type (415), a piece at an offset it
 * does not hold (409), and a piece other than the last that is not 6 MB.
 */

const ENDPOINT = 'https://project.supabase.co/storage/v1/upload/resumable';
const UPLOAD_URL = `${ENDPOINT}/upload-1`;
const SECOND_URL = `${ENDPOINT}/upload-2`;
const OBJECT = 'host-1/task-1/m1.mp4';

interface Reply {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyLength: number | null;
}

/** Answer as the storage would, as if nothing had been planned. */
const AS_USUAL = Symbol('as usual');
/** Never answer: the request hangs until it is aborted. */
const HANG = Symbol('hang');

/** What one request is answered with, out of the usual order. */
type Planned =
  | Reply
  | Error
  | typeof AS_USUAL
  | typeof HANG
  | ((storage: FakeStorage) => Reply | Error | typeof HANG);

function response({ status, headers = {}, body = '' }: Reply): Response {
  const byName = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => byName.get(name.toLowerCase()) ?? null },
    text: async () => body,
  } as unknown as Response;
}

/** A request that waits for its abort, as fetch does on a socket gone silent. */
function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  });
}

/** A storage that answers like Supabase's TUS endpoint, with planned exceptions. */
class FakeStorage {
  readonly calls: Call[] = [];
  /** How much of the file it holds; null before any upload exists. */
  offset: number | null = null;
  /** The length the upload was created with. */
  length: number = SIZE;
  private readonly planned: { method: string; reply: Planned }[] = [];
  private created = 0;

  plan(method: string, reply: Planned): void {
    this.planned.push({ method, reply });
  }

  readonly fetch = jest.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const method = init.method ?? 'GET';
    const headers = { ...(init.headers as Record<string, string>) };
    const body = init.body as Uint8Array | undefined;
    this.calls.push({ method, url, headers, bodyLength: body === undefined ? null : body.length });

    const index = this.planned.findIndex((entry) => entry.method === method);
    if (index >= 0) {
      const [{ reply }] = this.planned.splice(index, 1);
      if (reply === HANG) {
        return hang(init.signal);
      }
      if (reply !== AS_USUAL) {
        const answer = typeof reply === 'function' ? reply(this) : reply;
        if (answer === HANG) {
          return hang(init.signal);
        }
        if (answer instanceof Error) {
          throw answer;
        }
        return response(answer);
      }
    }
    return response(this.answer(method, headers, body));
  });

  private answer(method: string, headers: Record<string, string>, body?: Uint8Array): Reply {
    if (headers['Tus-Resumable'] !== '1.0.0') {
      return { status: 412 };
    }
    if (method === 'POST') {
      this.created += 1;
      this.offset = 0;
      this.length = Number(headers['Upload-Length']);
      return { status: 201, headers: { Location: this.created === 1 ? UPLOAD_URL : SECOND_URL } };
    }
    if (this.offset === null) {
      return { status: 404 };
    }
    if (method === 'HEAD') {
      return { status: 200, headers: { 'Upload-Offset': String(this.offset) } };
    }
    return this.piece(headers, body?.length ?? 0);
  }

  private piece(headers: Record<string, string>, length: number): Reply {
    if (headers['Content-Type'] !== 'application/offset+octet-stream') {
      return { status: 415 };
    }
    const offset = Number(headers['Upload-Offset']);
    if (offset !== this.offset) {
      return { status: 409 };
    }
    const isLast = offset + length === this.length;
    if (!isLast && length !== TUS_CHUNK_BYTES) {
      return { status: 400, body: JSON.stringify({ message: 'Chunk size must be 6MB' }) };
    }
    this.offset = offset + length;
    return { status: 204, headers: { 'Upload-Offset': String(this.offset) } };
  }

  methods(): string[] {
    return this.calls.map((call) => call.method);
  }

  patches(): { offset: number; length: number | null }[] {
    return this.calls
      .filter((call) => call.method === 'PATCH')
      .map((call) => ({ offset: Number(call.headers['Upload-Offset']), length: call.bodyLength }));
  }
}

/** A video on the phone, read piece by piece. */
function videoFile(size: number) {
  const reads: [number, number][] = [];
  let closed = false;
  const source: TusSource = {
    size,
    read: async (offset, length) => {
      reads.push([offset, length]);
      return new Uint8Array(length);
    },
    close: () => {
      closed = true;
    },
  };
  return { source, reads, isClosed: () => closed };
}

const IN_FRONT: TusPresence = {
  watchAway: () => ({ hasLeft: () => false, stop: () => undefined }),
  untilInFront: async () => undefined,
};

const SIZE = 2 * TUS_CHUNK_BYTES + 1000;

let storage: FakeStorage;
let file: ReturnType<typeof videoFile>;

function runtime(overrides: Partial<TusRuntime> = {}): TusRuntime {
  return {
    fetch: storage.fetch,
    sleep: jest.fn(async () => undefined),
    presence: IN_FRONT,
    isOnline: () => true,
    onOffline: jest.fn(() => () => undefined),
    ...overrides,
  };
}

/** An upload whose progress is always heard, so a test can read it back. */
type HeardUpload = TusUpload & { onProgress: jest.Mock<void, [number, number]> };

function upload(overrides: Partial<Omit<TusUpload, 'onProgress'>> = {}): HeardUpload {
  let issued = 0;
  return {
    onProgress: jest.fn<void, [number, number]>(),
    endpoint: ENDPOINT,
    apiKey: 'test-publishable-key',
    bucket: 'task-media',
    objectName: OBJECT,
    contentType: 'video/mp4',
    byteSize: SIZE,
    uploadUrl: null,
    saveUploadUrl: jest.fn(async () => undefined),
    accessToken: jest.fn(async (refresh: boolean) => {
      issued += 1;
      return refresh ? `fresh-${issued}` : `token-${issued}`;
    }),
    openSource: async () => file.source,
    ...overrides,
  };
}

function decodeMetadata(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(',').map((pair) => {
      const [key, value] = pair.split(' ');
      return [key, Buffer.from(value, 'base64').toString('utf8')];
    }),
  );
}

beforeEach(() => {
  storage = new FakeStorage();
  file = videoFile(SIZE);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a new upload', () => {
  test('is created with the protocol’s headers, its place in the bucket, and no upsert', async () => {
    // Arrange
    const video = upload();

    // Act
    await tusUpload(video, runtime());

    // Assert
    const [create] = storage.calls;
    expect(create.method).toBe('POST');
    expect(create.url).toBe(ENDPOINT);
    expect(create.headers).toMatchObject({
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(SIZE),
      Authorization: 'Bearer token-1',
      apikey: 'test-publishable-key',
    });
    expect(decodeMetadata(create.headers['Upload-Metadata'])).toEqual({
      bucketName: 'task-media',
      objectName: OBJECT,
      contentType: 'video/mp4',
      cacheControl: '3600',
    });
    expect(Object.keys(create.headers).map((name) => name.toLowerCase())).not.toContain('x-upsert');
    expect(video.saveUploadUrl).toHaveBeenCalledWith(UPLOAD_URL);
  });

  test('carries a name outside ASCII in its metadata as UTF-8', async () => {
    const named = 'хост/úklid-č.1/видео.mp4';

    await tusUpload(upload({ objectName: named }), runtime());

    expect(decodeMetadata(storage.calls[0].headers['Upload-Metadata']).objectName).toBe(named);
  });

  test('goes in pieces of exactly 6 MB, the last one shorter, each at its offset', async () => {
    await tusUpload(upload(), runtime());

    expect(TUS_CHUNK_BYTES).toBe(6 * 1024 * 1024);
    expect(storage.patches()).toEqual([
      { offset: 0, length: TUS_CHUNK_BYTES },
      { offset: TUS_CHUNK_BYTES, length: TUS_CHUNK_BYTES },
      { offset: 2 * TUS_CHUNK_BYTES, length: 1000 },
    ]);
    const patch = storage.calls.find((call) => call.method === 'PATCH');
    expect(patch?.url).toBe(UPLOAD_URL);
    expect(patch?.headers).toMatchObject({
      'Tus-Resumable': '1.0.0',
      'Content-Type': 'application/offset+octet-stream',
      apikey: 'test-publishable-key',
    });
    expect(storage.offset).toBe(SIZE);
  });

  test('reads the file a piece at a time, never whole, and closes it', async () => {
    await tusUpload(upload(), runtime());

    expect(file.reads).toEqual([
      [0, TUS_CHUNK_BYTES],
      [TUS_CHUNK_BYTES, TUS_CHUNK_BYTES],
      [2 * TUS_CHUNK_BYTES, 1000],
    ]);
    expect(file.isClosed()).toBe(true);
  });

  test('asks for the session’s token before every request, so a long upload outlives it', async () => {
    const video = upload();

    await tusUpload(video, runtime());

    expect(video.accessToken).toHaveBeenCalledTimes(storage.calls.length);
    expect(video.accessToken).not.toHaveBeenCalledWith(true);
    expect(storage.calls.map((call) => call.headers.Authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
      'Bearer token-3',
      'Bearer token-4',
    ]);
  });

  test('says how far it has got as the pieces arrive', async () => {
    const video = upload();

    await tusUpload(video, runtime());

    expect(video.onProgress.mock.calls).toEqual([
      [0, SIZE],
      [TUS_CHUNK_BYTES, SIZE],
      [2 * TUS_CHUNK_BYTES, SIZE],
      [SIZE, SIZE],
    ]);
  });

  test('a Location given as a path is read against the endpoint', async () => {
    storage.plan('POST', (self) => {
      self.offset = 0;
      return { status: 201, headers: { Location: '/storage/v1/upload/resumable/relative-1' } };
    });

    await tusUpload(upload(), runtime());

    expect(storage.patches()).toHaveLength(3);
    expect(storage.calls[1].url).toBe(`${ENDPOINT}/relative-1`);
  });
});

// The address is where every piece of the video goes, with her token on it:
// only the project's own storage, and only over TLS.
describe('the address of an upload', () => {
  test.each([
    ['on another host', 'https://elsewhere.example/storage/v1/upload/resumable/upload-1'],
    ['without TLS', 'http://project.supabase.co/storage/v1/upload/resumable/upload-1'],
  ])('%s is refused, and nothing is sent there', async (_name, location) => {
    storage.plan('POST', { status: 201, headers: { Location: location } });
    const video = upload();

    await expect(tusUpload(video, runtime())).rejects.toBeInstanceOf(TusRefusedError);

    expect(storage.methods()).toEqual(['POST']);
    expect(video.saveUploadUrl).not.toHaveBeenCalled();
  });

  test('missing is a refusal that names the answer it came with', async () => {
    storage.plan('POST', { status: 201 });

    const failure = tusUpload(upload(), runtime());

    await expect(failure).rejects.toBeInstanceOf(TusRefusedError);
    await expect(failure).rejects.toMatchObject({ status: 201 });
  });

  test('kept from before on another host is forgotten, and a new upload made', async () => {
    const video = upload({ uploadUrl: 'https://elsewhere.example/upload-1' });

    await tusUpload(video, runtime());

    expect(storage.methods()).toEqual(['POST', 'PATCH', 'PATCH', 'PATCH']);
    expect(jest.mocked(video.saveUploadUrl).mock.calls).toEqual([[null], [UPLOAD_URL]]);
  });
});

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

describe('the file on the phone', () => {
  // The phone's copy is deleted once the server confirms: what goes up must
  // be what was registered, or the loss is for good.
  test.each([
    ['a size other than the one registered', SIZE - 1],
    ['nothing at all', 0],
  ])('of %s is not uploaded, and kept', async (_name, size) => {
    file = videoFile(size);

    await expect(tusUpload(upload(), runtime())).rejects.toBeInstanceOf(TusFileError);

    expect(storage.calls).toEqual([]);
    expect(file.isClosed()).toBe(true);
  });

  test('that reads short fails the attempt rather than sending less', async () => {
    const short: TusSource = {
      size: SIZE,
      read: async (_offset, length) => new Uint8Array(length - 1),
      close: jest.fn(),
    };

    await expect(
      tusUpload(upload({ openSource: async () => short }), runtime()),
    ).rejects.toBeInstanceOf(TusFileError);

    expect(storage.patches()).toEqual([]);
    expect(short.close).toHaveBeenCalled();
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

test('a file that cannot be read fails the attempt and is closed', async () => {
  const broken: TusSource = {
    size: SIZE,
    read: async () => {
      throw new Error('File is not readable');
    },
    close: jest.fn(),
  };

  await expect(tusUpload(upload({ openSource: async () => broken }), runtime())).rejects.toThrow(
    'File is not readable',
  );

  expect(broken.close).toHaveBeenCalled();
});
