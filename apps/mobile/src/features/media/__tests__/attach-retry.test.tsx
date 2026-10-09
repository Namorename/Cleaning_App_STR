import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { stopWatchingConnection } from '@/lib/online';
import { createAppQueryClient } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';

import { addMedia } from '../api';
import { retryAttach } from '../attach-retry';
import { TusRetryableError } from '../tus';
import { useAttachMedia, type AttachMediaVariables } from '../use-media';

/**
 * How the upload queue tries again (review of video part 2, finding 3). A
 * failure of the network marks the queue offline, as the app's other moves
 * do, and waits for signal without spending a try; only the server's
 * refusals count against the three more tries an upload gets.
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
    ['a resumable upload that gave up on the network', new TusRetryableError('PATCH timed out')],
  ])('%s marks the queue offline and is tried again, whatever came before', (_name, error) => {
    expect(retryAttach(10, error)).toBe(true);
    expect(onlineManager.isOnline()).toBe(false);
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
