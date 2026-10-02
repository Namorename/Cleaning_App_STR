import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { FORGET_TIMEOUT_MS, clearThisPhone, registerPushToken, releaseThisPhone } from '../api';
import { rememberToken, signOutsSoFar, trackRegistration } from '../token-store';

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
  jest.mocked(Notifications.dismissAllNotificationsAsync).mockClear();
  jest.mocked(Notifications.clearLastNotificationResponse).mockClear();
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

/**
 * Letting go is two steps (docs/f11-native-review.md, Т-2): the server first,
 * while she is still signed in; the phone's own record only once she is out.
 * A sign-out that fails keeps the record, so the next one can let go of it.
 */
describe('releaseThisPhone', () => {
  test('lets go of the token this phone registered, says the server heard, and keeps the record', async () => {
    await rememberToken(TOKEN);
    const { abortSignal } = rpcAnswering(Promise.resolve({ error: null }));

    await expect(releaseThisPhone()).resolves.toBe('released');

    expect(mockRpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TOKEN });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(Object));
    await expect(SecureStore.getItemAsync('push-token')).resolves.toBe(TOKEN);
  });

  test('a phone that never registered asks the server nothing', async () => {
    await expect(releaseThisPhone()).resolves.toBe('nothing');

    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('a failure does not stop her signing out: it says the server did not hear', async () => {
    await rememberToken(TOKEN);
    rpcAnswering(Promise.resolve({ error: { message: 'TypeError: Network request failed' } }));

    await expect(releaseThisPhone()).resolves.toBe('unconfirmed');

    await expect(SecureStore.getItemAsync('push-token')).resolves.toBe(TOKEN);
  });

  test('a server that does not answer is given up on after a few seconds', async () => {
    jest.useFakeTimers();
    try {
      await rememberToken(TOKEN);
      const { abortSignal } = rpcAnswering(new Promise(() => undefined));

      const releasing = releaseThisPhone();
      await jest.advanceTimersByTimeAsync(FORGET_TIMEOUT_MS);

      await expect(releasing).resolves.toBe('unconfirmed');
      const signal = abortSignal.mock.calls[0][0];
      expect(signal.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  // Т-1: a registration answered after the let-go would give the phone back to her.
  test('a registration on its way is waited for, and the token it got is let go of', async () => {
    let finish: () => void = () => undefined;
    trackRegistration(
      'me',
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      }),
    );
    rpcAnswering(Promise.resolve({ error: null }));

    const releasing = releaseThisPhone();
    await rememberToken(TOKEN);
    finish();

    await expect(releasing).resolves.toBe('released');
    expect(mockRpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TOKEN });
  });

  test('a registration that does not end is waited for no longer than a let-go takes', async () => {
    jest.useFakeTimers();
    try {
      // The token is written before the server call that never answers.
      await rememberToken(TOKEN);
      trackRegistration('me', new Promise<boolean>(() => undefined));
      rpcAnswering(Promise.resolve({ error: null }));

      const releasing = releaseThisPhone();
      await jest.advanceTimersByTimeAsync(FORGET_TIMEOUT_MS);

      await expect(releasing).resolves.toBe('released');
      expect(mockRpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TOKEN });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('clearThisPhone — once she is out', () => {
  test('the phone forgets the token, and counts the sign-out', async () => {
    await rememberToken(TOKEN);
    const before = signOutsSoFar();

    await clearThisPhone();

    await expect(SecureStore.getItemAsync('push-token')).resolves.toBeNull();
    expect(signOutsSoFar()).toBe(before + 1);
  });

  test('her delivered notifications leave the tray, and a pending tap is dropped', async () => {
    // A phone being handed on must not show the next person her flats, nor
    // open one of her pushes for them after they sign in.
    await clearThisPhone();

    expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  test('a tray that cannot be emptied does not stop her signing out', async () => {
    jest
      .mocked(Notifications.dismissAllNotificationsAsync)
      .mockRejectedValueOnce(new Error('native module missing'));
    jest.mocked(Notifications.clearLastNotificationResponse).mockImplementationOnce(() => {
      throw new Error('native module missing');
    });

    await expect(clearThisPhone()).resolves.toBeUndefined();
  });
});
