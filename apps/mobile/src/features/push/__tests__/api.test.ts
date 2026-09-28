import * as SecureStore from 'expo-secure-store';

import { FORGET_TIMEOUT_MS, forgetThisPhone, registerPushToken } from '../api';
import { rememberRegistration } from '../token-store';

/**
 * The phone's token on the server: registered once she allows pushes, let go
 * of before she signs out — directly, never through the offline queue. A let-go
 * replayed after the next person signed in on the same phone would run as her
 * and delete her registration instead.
 */

const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const TOKEN = 'ExponentPushToken[abc]';

/** `rpc(name, args).abortSignal(signal)`, answering `result`. */
function rpcAnswering(result: Promise<{ error: unknown }>) {
  const abortSignal = jest.fn((_signal: AbortSignal) => result);
  mockRpc.mockReturnValue({ abortSignal, then: result.then.bind(result) });
  return { abortSignal };
}

beforeEach(async () => {
  mockRpc.mockReset();
  await SecureStore.deleteItemAsync('push-token');
});

describe('registerPushToken', () => {
  test('sends the token, the platform, the language and the version', async () => {
    rpcAnswering(Promise.resolve({ error: null }));

    await registerPushToken({
      token: TOKEN,
      platform: 'android',
      language: 'cs',
      appVersion: '1.1.0',
    });

    expect(mockRpc).toHaveBeenCalledWith('register_push_token', {
      p_token: TOKEN,
      p_platform: 'android',
      p_language: 'cs',
      p_app_version: '1.1.0',
    });
  });

  test('a refusal reaches the caller', async () => {
    const refusal = { message: 'no', hint: 'serverErrors.notSignedIn', code: '42501' };
    rpcAnswering(Promise.resolve({ error: refusal }));

    await expect(
      registerPushToken({ token: TOKEN, platform: 'ios', language: 'ru', appVersion: null }),
    ).rejects.toBe(refusal);
  });
});

describe('forgetThisPhone', () => {
  test('lets go of the token this phone registered, and forgets it', async () => {
    await rememberRegistration(TOKEN, 'me|ru');
    const { abortSignal } = rpcAnswering(Promise.resolve({ error: null }));

    await forgetThisPhone();

    expect(mockRpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TOKEN });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(Object));
    await expect(SecureStore.getItemAsync('push-token')).resolves.toBeNull();
  });

  test('a phone that never registered asks the server nothing', async () => {
    await forgetThisPhone();

    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('a failure does not stop her signing out, and the token is forgotten anyway', async () => {
    await rememberRegistration(TOKEN, 'me|ru');
    rpcAnswering(Promise.resolve({ error: { message: 'TypeError: Network request failed' } }));

    await expect(forgetThisPhone()).resolves.toBeUndefined();

    await expect(SecureStore.getItemAsync('push-token')).resolves.toBeNull();
  });

  test('a server that does not answer is given up on after a few seconds', async () => {
    jest.useFakeTimers();
    try {
      await rememberRegistration(TOKEN, 'me|ru');
      const { abortSignal } = rpcAnswering(new Promise(() => undefined));

      const forgetting = forgetThisPhone();
      await jest.advanceTimersByTimeAsync(FORGET_TIMEOUT_MS);

      await expect(forgetting).resolves.toBeUndefined();
      const signal = abortSignal.mock.calls[0][0];
      expect(signal.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
