import * as Sentry from '@sentry/react-native';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { stopWatchingConnection } from '@/lib/online';
import { createAppQueryClient } from '@/lib/query-client';
import { signedInWithQueue, signedOutOfQueue } from '@/testing/queue-person';
import { withClient } from '@/testing/restored-cache';

import { ANSWERED_RETRIES, SILENT_RETRIES, STALL_RETRIES } from '../attach-retry';
import { rememberLocalMedia } from '../local-store';
import { TUS_RETRY_DELAYS_MS } from '../tus';
import { uploadFailureOf } from '../upload-failure';
import { useAttachMedia, type AttachMediaVariables } from '../use-media';

/**
 * A video's upload as the queue runs it, end to end: the queue, the
 * resumable client and the app's clock, against a storage that never gets
 * better (the third pass on video, finding 3; the fourth, finding 1).
 * Whatever goes wrong, the number of requests in an hour is bounded: an
 * outage of the whole network waits for signal; an answer of the storage
 * spends a try; and silence from the storage while the server answers spends
 * one too. An upload that cannot go through fails, for its tile to say so.
 */

const MEDIA_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const STEP_ID = 'b1c2d3e4-1111-4111-8111-b1c2d3e40001';
const HEALTH = 'https://project.supabase.co/auth/v1/health';
const UPLOAD_URL = 'https://project.supabase.co/storage/v1/upload/resumable/upload-1';
const mockSize = 2 * 6 * 1024 * 1024 + 1000;

const mockRpc = jest.fn();

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
  openFileChunks: jest.fn(async () => ({
    size: mockSize,
    read: async (_offset: number, length: number) => new Uint8Array(length),
    close: () => undefined,
  })),
}));

const video: AttachMediaVariables = {
  taskId: TASK_ID,
  stepId: STEP_ID,
  uri: `file:///documents/task-media/${MEDIA_ID}.mp4`,
  mediaId: MEDIA_ID,
  kind: 'video',
  mimeType: 'video/mp4',
  byteSize: mockSize,
  width: null,
  height: null,
  durationSec: 12.3,
  takenAt: '2026-10-09T08:00:00.000Z',
  source: 'camera',
};

/** The row the server registers the video with: its file still to come. */
const row = {
  id: MEDIA_ID,
  task_id: TASK_ID,
  step_id: STEP_ID,
  problem_id: null,
  kind: 'video',
  storage_path: `host-1/${TASK_ID}/${MEDIA_ID}.mp4`,
  mime_type: 'video/mp4',
  duration_sec: 12.3,
  device_taken_at: video.takenAt,
  created_at: video.takenAt,
  uploaded_at: null,
  deleted_at: null,
};

/** An hour of the phone's clock, in steps the screen would redraw at. */
const AN_HOUR_MS = 60 * 60_000;
const STEP_MS = 10_000;

interface UploadRequest {
  method: string;
  startedAt: number;
  /** When the phone gave up on it, for a request that never got an answer. */
  abortedAt: number | null;
}

/** What the storage answers each request with; the server's health always answers. */
type Storage = (method: string, signal: AbortSignal | null | undefined) => Promise<Response>;

let requests: UploadRequest[];
let client: QueryClient;

function answer(status: number, headers: Record<string, string> = {}): Response {
  const byName = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => byName.get(name.toLowerCase()) ?? null },
    text: async () => '',
  } as unknown as Response;
}

/** The network as the phone meets it: the server's health check, and the storage. */
function network(storage: Storage, health: () => Promise<Response>) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === HEALTH) {
      return health();
    }
    const request: UploadRequest = {
      method: init?.method ?? 'GET',
      startedAt: Date.now(),
      abortedAt: null,
    };
    requests.push(request);
    init?.signal?.addEventListener('abort', () => {
      request.abortedAt = Date.now();
    });
    return storage(request.method, init?.signal);
  }) as typeof fetch;
}

/** A request that waits for its abort, as a socket gone silent does. */
function silence(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  });
}

async function sendAndWaitAnHour() {
  const { result } = await renderHook(() => useAttachMedia('video'), {
    wrapper: withClient(client),
  });
  await act(async () => {
    result.current.mutate(video);
  });
  for (let elapsed = 0; elapsed < AN_HOUR_MS; elapsed += STEP_MS) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(STEP_MS);
    });
  }
  return result;
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  onlineManager.setOnline(true);
  requests = [];
  mockRpc.mockImplementation(async (name: string) =>
    name === 'add_task_media'
      ? { data: row, error: null }
      : { data: { ...row, uploaded_at: '2026-10-09T08:30:00.000Z' }, error: null },
  );
  await rememberLocalMedia({ ...video, id: MEDIA_ID });
  client = createAppQueryClient();
  // Her uploads, resumed when the signal is back (lib/move-queue.ts).
  signedInWithQueue(client);
});

afterEach(() => {
  client.clear();
  signedOutOfQueue();
  stopWatchingConnection();
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

/** The tries one attempt of the queue makes of a request before it hands back. */
const TRIES_PER_ATTEMPT = TUS_RETRY_DELAYS_MS.length + 1;

test('a permanent outage makes one attempt’s requests in an hour, then waits for signal', async () => {
  // Arrange: nothing answers, not even the server's health check.
  const lost = () => Promise.reject(new TypeError('Network request failed'));
  network(lost, lost);

  // Act
  const result = await sendAndWaitAnHour();

  // Assert
  expect(requests).toHaveLength(TRIES_PER_ATTEMPT);
  expect(onlineManager.isOnline()).toBe(false);
  expect(result.current.status).toBe('pending');
});

// The server answers its health check, so the queue comes back online after
// each failure — but the storage's own host is out of reach: a DNS filter, a
// proxy, an outage that does not answer (the fourth pass on video, finding 1).
describe('a storage host out of reach while the server answers', () => {
  test('refusing every connection, it is given up on after its attempts, not looped on', async () => {
    // Arrange
    network(
      () => Promise.reject(new TypeError('Network request failed')),
      async () => answer(200),
    );

    // Act
    const result = await sendAndWaitAnHour();

    // Assert
    expect(SILENT_RETRIES).toBe(4);
    expect(requests).toHaveLength((SILENT_RETRIES + 1) * TRIES_PER_ATTEMPT);
    expect(result.current.status).toBe('error');
    expect(onlineManager.isOnline()).toBe(true);
  });

  test('never answering at all, it is given up on after its attempts, not looped on', async () => {
    // Arrange
    network(
      (_method, signal) => silence(signal),
      async () => answer(200),
    );

    // Act
    const result = await sendAndWaitAnHour();

    // Assert: each request was cut in its time; none is left hanging.
    expect(requests).toHaveLength((SILENT_RETRIES + 1) * TRIES_PER_ATTEMPT);
    expect(requests.every((request) => request.abortedAt !== null)).toBe(true);
    expect(result.current.status).toBe('error');
    expect(onlineManager.isOnline()).toBe(true);
  });
});

test('a storage that answers 503 for ever is given up on after its tries, not looped on', async () => {
  // Arrange: the server is there; its storage is not.
  network(
    async () => answer(503),
    async () => answer(200),
  );

  // Act
  const result = await sendAndWaitAnHour();

  // Assert
  expect(requests).toHaveLength((ANSWERED_RETRIES + 1) * TRIES_PER_ATTEMPT);
  expect(result.current.status).toBe('error');
  expect(onlineManager.isOnline()).toBe(true);
});

// Some 300 kbit/s of uplink would need more than two minutes for a piece.
test('a piece that never moves fails the upload after four tries of growing length', async () => {
  // Arrange: the upload is created and found; no piece ever arrives.
  network(
    async (method, signal) => {
      if (method === 'POST') {
        return answer(201, { Location: UPLOAD_URL });
      }
      if (method === 'HEAD') {
        return answer(200, { 'Upload-Offset': '0' });
      }
      return silence(signal);
    },
    async () => answer(200),
  );

  // Act
  const result = await sendAndWaitAnHour();

  // Assert
  const pieces = requests.filter((request) => request.method === 'PATCH');
  expect(pieces).toHaveLength(STALL_RETRIES + 1);
  expect(pieces.map((piece) => (piece.abortedAt ?? 0) - piece.startedAt)).toEqual([
    120_000, 240_000, 480_000, 600_000,
  ]);
  expect(result.current.status).toBe('error');
});

// Night of 2026-10-10, block 1: a 105.9 MB video of the owner's was turned
// down — the company allowed 140 MB, the project's plan takes 50 — and its
// tile said only «Не загрузилось». The queue gives up after its tries, the
// tile can name the storage's answer, and each attempt is marked for the
// crash report, by id and kind, never by path.
test('a video the storage turns down as too large fails with that reason, its attempts marked', async () => {
  // Arrange: the storage refuses the upload's creation, as Supabase does above the plan's limit.
  network(
    async (method) => (method === 'POST' ? answer(413) : answer(500)),
    async () => answer(200),
  );

  // Act
  const result = await sendAndWaitAnHour();

  // Assert
  expect(result.current.status).toBe('error');
  expect(uploadFailureOf(result.current.error)).toEqual({ key: 'tooLarge' });
  const marks = jest.mocked(Sentry.addBreadcrumb).mock.calls.map(([crumb]) => crumb);
  expect(marks.filter((crumb) => crumb.message === 'failed').at(-1)).toMatchObject({
    category: 'media.attach',
    data: { mediaId: MEDIA_ID, kind: 'video', reason: 'tooLarge' },
  });
  expect(JSON.stringify(marks)).not.toMatch(/file:\/\//);
});
