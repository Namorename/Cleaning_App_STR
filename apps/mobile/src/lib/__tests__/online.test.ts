import { MutationObserver, onlineManager } from '@tanstack/react-query';

import { createAppQueryClient } from '../query-client';
import { goOffline, isNetworkError, PROBE_INTERVAL_MS, stopWatchingConnection } from '../online';

/**
 * A move tapped in a stairwell waits for signal instead of failing.
 *
 * Nothing on a phone tells TanStack the network is gone — its own listener is
 * the browser's online/offline event — so every move failed after one retry
 * and was never queued. Now a failure that is the network's marks the client
 * offline: the move pauses on disk and goes through once a look at the server
 * finds it again.
 */

beforeEach(() => {
  jest.useFakeTimers();
  onlineManager.setOnline(true);
});

afterEach(() => {
  stopWatchingConnection();
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

describe('what counts as no signal', () => {
  test.each([
    ['a fetch that could not reach anything', new TypeError('Network request failed')],
    ['the auth client wrapping one', { name: 'AuthRetryableFetchError', status: 0, message: 'x' }],
    [
      'a table read that never left the phone',
      { message: 'TypeError: Network request failed', details: '', hint: '', code: '' },
    ],
    [
      'an upload that never left the phone',
      { name: 'StorageUnknownError', originalError: new TypeError('Network request failed') },
    ],
    // expo/fetch, the app's fetch since SDK 52, rejects in its own words.
    ['expo/fetch that could not reach anything', new TypeError('fetch failed')],
    [
      'an Android phone without DNS',
      new Error(
        'Unable to resolve host "project.supabase.co": No address associated with hostname',
      ),
    ],
    [
      'an Android phone that could not connect',
      new Error('Failed to connect to project.supabase.co/104.18.38.10:443'),
    ],
    ['OkHttp giving up on a silent socket', new Error('timeout')],
    ['an iPhone giving up on one', new Error('The request timed out.')],
    ['expo/fetch giving up on one', new TypeError('fetch failed: timeout')],
    [
      'a table read whose socket went silent',
      { message: 'TypeError: Network request timed out', details: '', hint: '', code: '' },
    ],
  ])('%s', (_name, error) => {
    expect(isNetworkError(error)).toBe(true);
  });

  test.each([
    [
      'a refusal the server sent',
      { message: 'no', hint: 'serverErrors.taskClosed', code: 'P0001' },
    ],
    ['a server that failed', { message: 'Internal Server Error', status: 500 }],
    ['a bug', new Error('undefined is not a function')],
    // The database's own timeout is an answer from the server, not a lost socket.
    [
      'a statement the database cancelled',
      { message: 'canceling statement due to statement timeout', code: '57014' },
    ],
    // A server's words for its own wait are an answer, whatever they say.
    [
      'PostgREST out of connections',
      {
        message: 'Timed out acquiring connection from connection pool.',
        code: 'PGRST003',
        details: null,
        hint: null,
      },
    ],
    ['a gateway that waited in vain', { message: 'upstream request timeout', status: 504 }],
    ['a server that timed the request out', { message: 'Request timed out', status: 408 }],
    [
      'a refusal that only mentions a fetch',
      { message: 'Edge Function: fetch failed', code: 'X1' },
    ],
  ])('%s is not', (_name, error) => {
    expect(isNetworkError(error)).toBe(false);
  });
});

describe('finding the way back', () => {
  test('no signal marks the app offline, and a look at the server brings it back', async () => {
    // Arrange: the first look finds nothing, the second finds the server.
    const probe = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue(undefined);

    // Act / Assert
    goOffline(probe);
    expect(onlineManager.isOnline()).toBe(false);

    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS);
    expect(onlineManager.isOnline()).toBe(false);

    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS);
    expect(onlineManager.isOnline()).toBe(true);

    // Once back, it stops looking.
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 3);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  test('a second failure while already looking does not start a second look', async () => {
    const probe = jest.fn<Promise<void>, []>().mockRejectedValue(new TypeError('x'));

    goOffline(probe);
    goOffline(probe);
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS);

    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe('a move without signal', () => {
  const failingThenFine = () =>
    jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue('done');

  test('waits for signal instead of failing, and goes through when it is back', async () => {
    // Arrange: the server is never found by a look during this test.
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    const client = createAppQueryClient();
    client.mount();
    const mutationFn = failingThenFine();
    const observer = new MutationObserver(client, { mutationFn });

    // Act
    const result = observer.mutate('task-1');
    await jest.advanceTimersByTimeAsync(5_000);

    // Assert: paused, not failed.
    expect(observer.getCurrentResult().isPaused).toBe(true);
    expect(observer.getCurrentResult().status).toBe('pending');

    onlineManager.setOnline(true);
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toBe('done');
    expect(mutationFn).toHaveBeenCalledTimes(2);
    client.unmount();
  });

  test('a refusal from the server still fails after one more try, as before', async () => {
    const client = createAppQueryClient();
    client.mount();
    const refusal = { message: 'no', hint: 'serverErrors.taskClosed', code: 'P0001' };
    const mutationFn = jest.fn<Promise<string>, [string]>().mockRejectedValue(refusal);
    const observer = new MutationObserver(client, { mutationFn });

    const result = observer.mutate('task-1').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBe(refusal);
    expect(mutationFn).toHaveBeenCalledTimes(2);
    expect(onlineManager.isOnline()).toBe(true);
    client.unmount();
  });
});
