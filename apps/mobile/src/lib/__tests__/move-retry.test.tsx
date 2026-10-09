import { onlineManager, useMutation, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { SILENT_RETRIES } from '@/features/media/attach-retry';
import { stopWatchingConnection } from '@/lib/online';
import { createAppQueryClient } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';

/**
 * How a move of the app — a step ticked, a cleaning started — tries again
 * when the network fails it (lib/query-client.ts, retryMove). Without signal
 * it waits on disk however long that lasts. Left unanswered while the server
 * answers the look for it, it is given up on after as many tries as an upload
 * is (the two whole-branch reviews of phone-1-2-0, finding 3): otherwise each
 * look that finds the server sends it again, every fifteen seconds, for ever,
 * and the screen never says it did not go.
 */

/** Longer than every backoff and every look for the server this file waits for. */
const LONG_ENOUGH_MS = 15 * 60_000;
const STEP_MS = 5_000;

const noAnswer = () => new TypeError('Network request failed');

let client: QueryClient;

beforeEach(() => {
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

/** A move of the app's, with no retry of its own: the client's default decides. */
async function makeMove(move: jest.Mock) {
  const { result } = await renderHook(
    () => useMutation({ mutationKey: ['moves', 'test'], mutationFn: move }),
    { wrapper: withClient(client) },
  );
  await act(async () => {
    result.current.mutate('t1');
  });
  await letTimePass();
  return result;
}

test('left unanswered while the server answers, fails after four more attempts', async () => {
  // Arrange
  const move = jest.fn(async () => {
    throw noAnswer();
  });

  // Act
  const result = await makeMove(move);

  // Assert
  expect(SILENT_RETRIES).toBe(4);
  expect(move).toHaveBeenCalledTimes(SILENT_RETRIES + 1);
  expect(result.current.status).toBe('error');
});

test('without signal at all, waits for it however long, trying nothing more', async () => {
  // Arrange: not even the server's health check answers.
  global.fetch = jest.fn(async () => {
    throw noAnswer();
  });
  const move = jest.fn(async () => {
    throw noAnswer();
  });

  // Act
  const result = await makeMove(move);

  // Assert
  expect(move).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe('pending');
  expect(onlineManager.isOnline()).toBe(false);
});

// A stairwell: the signal went while the move was on its way, each time.
test('cut because the signal went, it is the network’s and does not count', async () => {
  let attempts = 0;
  const move = jest.fn(async () => {
    attempts += 1;
    if (attempts <= 9) {
      onlineManager.setOnline(false);
      throw noAnswer();
    }
  });

  const result = await makeMove(move);

  expect(move).toHaveBeenCalledTimes(10);
  expect(result.current.status).toBe('success');
});

test('refused by the server, it gets its one more try, as before', async () => {
  const refusal = { message: 'Task is not yours', code: 'P0001' };
  const move = jest.fn(async () => {
    throw refusal;
  });

  const result = await makeMove(move);

  expect(move).toHaveBeenCalledTimes(2);
  expect(result.current.error).toBe(refusal);
});
