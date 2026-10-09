import {
  TUS_CHUNK_BYTES,
  type TusPresence,
  type TusRuntime,
  type TusSource,
  type TusUpload,
} from '@/features/media/tus';

/**
 * The stage of the resumable upload's tests (`features/media/__tests__/tus-*`):
 * a video (docs/tech-plan.md §7.5) against a storage that keeps its offset the
 * way Supabase's does — created by POST, asked by HEAD, fed by PATCH in pieces
 * of exactly 6 MB. The storage here is strict the way a TUS server is: it
 * refuses a request without the protocol's version (412), a piece of the wrong
 * type (415), a piece at an offset it does not hold (409), and a piece other
 * than the last that is not 6 MB.
 *
 * One storage and one file serve every test, set back before each of them:
 * each file calls `setUpTusStorage()` once, at its top.
 */

export const ENDPOINT = 'https://project.supabase.co/storage/v1/upload/resumable';
export const UPLOAD_URL = `${ENDPOINT}/upload-1`;
export const SECOND_URL = `${ENDPOINT}/upload-2`;
export const OBJECT = 'host-1/task-1/m1.mp4';

export const SIZE = 2 * TUS_CHUNK_BYTES + 1000;

export interface Reply {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  /** The headers arrive; the body never finishes, abort or not. */
  isBodyStuck?: boolean;
  /** The headers arrive; the connection fails while the body is read. */
  isBodyLost?: boolean;
}

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyLength: number | null;
}

/** Answer as the storage would, as if nothing had been planned. */
export const AS_USUAL = Symbol('as usual');
/** Never answer: the request hangs until it is aborted. */
export const HANG = Symbol('hang');

/** What one request is answered with, out of the usual order. */
export type Planned =
  | Reply
  | Error
  | typeof AS_USUAL
  | typeof HANG
  | ((storage: FakeStorage) => Reply | Error | typeof HANG);

function response({
  status,
  headers = {},
  body = '',
  isBodyStuck = false,
  isBodyLost = false,
}: Reply): Response {
  const byName = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const text = () => {
    if (isBodyStuck) {
      return new Promise<string>(() => undefined);
    }
    return isBodyLost
      ? Promise.reject(new TypeError('Network request failed'))
      : Promise.resolve(body);
  };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => byName.get(name.toLowerCase()) ?? null },
    text,
  } as unknown as Response;
}

/** A request that waits for its abort, as fetch does on a socket gone silent. */
function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  });
}

/** A storage that answers like Supabase's TUS endpoint, with planned exceptions. */
export class FakeStorage {
  readonly calls: Call[] = [];
  /** How much of the file it holds; null before any upload exists. */
  offset: number | null = null;
  /** The length the upload was created with. */
  length: number = SIZE;
  private readonly planned: { method: string; reply: Planned }[] = [];
  private created = 0;

  private readonly handle = async (url: string, init: RequestInit): Promise<Response> => {
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
  };

  readonly fetch = jest.fn(this.handle);

  plan(method: string, reply: Planned): void {
    this.planned.push({ method, reply });
  }

  /** Back to an empty storage that answers as usual, as each test starts with it. */
  reset(): void {
    this.calls.length = 0;
    this.offset = null;
    this.length = SIZE;
    this.planned.length = 0;
    this.created = 0;
    this.fetch.mockReset();
    this.fetch.mockImplementation(this.handle);
  }

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
export function videoFile(size: number) {
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
  const reset = () => {
    reads.length = 0;
    closed = false;
  };
  return { source, reads, isClosed: () => closed, reset };
}

export const IN_FRONT: TusPresence = {
  watchAway: () => ({ hasLeft: () => false, stop: () => undefined }),
  untilInFront: async () => undefined,
};

/** The storage every test talks to. */
export const storage = new FakeStorage();
/** The video every test sends, unless it hands over a source of its own. */
export const file = videoFile(SIZE);

export function runtime(overrides: Partial<TusRuntime> = {}): TusRuntime {
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

export function upload(overrides: Partial<Omit<TusUpload, 'onProgress'>> = {}): HeardUpload {
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

export function decodeMetadata(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(',').map((pair) => {
      const [key, value] = pair.split(' ');
      return [key, Buffer.from(value, 'base64').toString('utf8')];
    }),
  );
}

/** Each test of the file starts on an empty storage and an unread file. */
export function setUpTusStorage(): void {
  beforeEach(() => {
    storage.reset();
    file.reset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
}
