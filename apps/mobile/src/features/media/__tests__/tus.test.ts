import { isNetworkError } from '@/lib/network-error';

import {
  TUS_CHUNK_BYTES,
  TUS_RETRY_DELAYS_MS,
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
 * HEAD, fed by PATCH in pieces of exactly 6 MB.
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

/** What one request is answered with, out of the usual order. */
type Planned = Reply | Error | ((storage: FakeStorage) => Reply | Error);

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

/** A storage that answers like Supabase's TUS endpoint, with planned exceptions. */
class FakeStorage {
  readonly calls: Call[] = [];
  /** How much of the file it holds; null before any upload exists. */
  offset: number | null = null;
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
      const answer = typeof reply === 'function' ? reply(this) : reply;
      if (answer instanceof Error) {
        throw answer;
      }
      return response(answer);
    }
    return response(this.answer(method, headers, body));
  });

  private answer(method: string, headers: Record<string, string>, body?: Uint8Array): Reply {
    if (method === 'POST') {
      this.created += 1;
      this.offset = 0;
      return { status: 201, headers: { Location: this.created === 1 ? UPLOAD_URL : SECOND_URL } };
    }
    if (method === 'HEAD') {
      return { status: 200, headers: { 'Upload-Offset': String(this.offset ?? 0) } };
    }
    this.offset = Number(headers['Upload-Offset']) + (body?.length ?? 0);
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

describe('an expired session', () => {
  test('is refreshed once and the request made again', async () => {
    // Arrange
    storage.plan('PATCH', { status: 401 });
    const video = upload();

    // Act
    await tusUpload(video, runtime());

    // Assert
    expect(video.accessToken).toHaveBeenCalledWith(true);
    const [refused, again] = storage.calls.filter((call) => call.method === 'PATCH');
    expect(again.headers.Authorization).toMatch(/^Bearer fresh-/);
    expect(again.headers['Upload-Offset']).toBe(refused.headers['Upload-Offset']);
    expect(storage.patches()).toHaveLength(4);
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
    storage.plan('PATCH', { status: 204, headers: { 'Upload-Offset': String(TUS_CHUNK_BYTES) } });
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
    expect(jest.mocked(run.sleep).mock.calls).toEqual(TUS_RETRY_DELAYS_MS.map((ms) => [ms]));
    expect(storage.fetch).toHaveBeenCalledTimes(TUS_RETRY_DELAYS_MS.length + 1);
  });

  test.each([500, 503, 423, 429])('a busy server (%i) is tried again too', async (status) => {
    storage.plan('PATCH', { status });
    const run = runtime();

    await tusUpload(upload(), run);

    expect(run.sleep).toHaveBeenCalledTimes(1);
    expect(storage.patches()).toHaveLength(4);
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
