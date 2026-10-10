import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { clearThisPhone, releasePushToken } from '../api';
import {
  flushPendingRelease,
  keepReleasePending,
  keepThisPhonePending,
  letGoAfterSessionEnded,
  pendingRelease,
  settlePendingRelease,
} from '../pending-release';
import { beginSignOut, endSignOut, rememberToken } from '../token-store';

/**
 * A phone let go of after a sign-out it could not confirm (owner's word of
 * 2026-10-11, 00:40). Without signal the sign-out removes her session all the
 * same, and the server goes on sending her pushes to the phone; a session that
 * ends without the button never lets go at all. The phone keeps the token as
 * "to be let go of" and sends release_push_token(token, since) — no session
 * needed — when it can: at the start, on coming back to the app, on coming
 * back online (hooks.ts). The server lets go only if nobody bound the token
 * again after `since`.
 */

jest.mock('../api', () => ({
  releasePushToken: jest.fn(async () => true),
  clearThisPhone: jest.fn(async () => {
    await jest
      .requireActual<typeof import('../token-store')>('../token-store')
      .forgetRegistration();
  }),
}));

const release = jest.mocked(releasePushToken);
const clear = jest.mocked(clearThisPhone);

const TOKEN = 'ExponentPushToken[anna-phone]';
const SINCE = new Date('2026-10-11T07:00:00.000Z');

beforeEach(async () => {
  await SecureStore.deleteItemAsync('push-token-release');
  await SecureStore.deleteItemAsync('push-token');
  release.mockReset().mockResolvedValue(true);
  clear.mockClear();
});

describe('what is kept', () => {
  test('the token and the moment it was let go of', async () => {
    await keepReleasePending(TOKEN, SINCE);

    await expect(pendingRelease()).resolves.toEqual({ token: TOKEN, since: SINCE.toISOString() });
  });

  test('the phone’s own token, when it has one', async () => {
    await rememberToken(TOKEN);

    await keepThisPhonePending(SINCE);

    await expect(pendingRelease()).resolves.toEqual({ token: TOKEN, since: SINCE.toISOString() });
  });

  test('nothing, when the phone had no token', async () => {
    await keepThisPhonePending(SINCE);

    await expect(pendingRelease()).resolves.toBeNull();
  });

  test('something unreadable is no release, and goes', async () => {
    await SecureStore.setItemAsync('push-token-release', '{not json');

    await expect(pendingRelease()).resolves.toBeNull();
    await expect(SecureStore.getItemAsync('push-token-release')).resolves.toBeNull();
  });
});

describe('sending it', () => {
  test('nothing kept: nothing is asked of the server', async () => {
    await flushPendingRelease();

    expect(release).not.toHaveBeenCalled();
  });

  test('heard: the server is asked with the token and the moment, and it is forgotten', async () => {
    await keepReleasePending(TOKEN, SINCE);

    await flushPendingRelease();

    expect(release).toHaveBeenCalledWith(TOKEN, SINCE.toISOString());
    await expect(pendingRelease()).resolves.toBeNull();
  });

  test('not heard (no signal, no answer, a refusal): it stays for the next chance', async () => {
    release.mockResolvedValue(false);
    await keepReleasePending(TOKEN, SINCE);

    await flushPendingRelease();

    await expect(pendingRelease()).resolves.toEqual({ token: TOKEN, since: SINCE.toISOString() });
  });

  test('asked twice at once, it goes once', async () => {
    await keepReleasePending(TOKEN, SINCE);

    await Promise.all([flushPendingRelease(), flushPendingRelease()]);

    expect(release).toHaveBeenCalledTimes(1);
  });

  test('a release kept meanwhile for a later sign-out is not forgotten with the earlier one', async () => {
    const later = new Date('2026-10-11T09:00:00.000Z');
    await keepReleasePending(TOKEN, SINCE);
    release.mockImplementationOnce(async () => {
      await keepReleasePending('ExponentPushToken[next-phone]', later);
      return true;
    });

    await flushPendingRelease();

    await expect(pendingRelease()).resolves.toEqual({
      token: 'ExponentPushToken[next-phone]',
      since: later.toISOString(),
    });
  });

  test('never throws: a store that fails is the next chance’s', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('keychain locked'));

    await expect(flushPendingRelease()).resolves.toBeUndefined();
  });

  test('the web build has no pushes, and nothing to let go of', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    await keepReleasePending(TOKEN, SINCE);

    await flushPendingRelease();

    expect(release).not.toHaveBeenCalled();
    os.restore();
  });
});

describe('a registration that lands', () => {
  test('settles the release of its own token: the binding moved anyway', async () => {
    await keepReleasePending(TOKEN, SINCE);

    await settlePendingRelease(TOKEN);

    await expect(pendingRelease()).resolves.toBeNull();
  });

  test('leaves the release of another token: that binding is still the old one', async () => {
    await keepReleasePending(TOKEN, SINCE);

    await settlePendingRelease('ExponentPushToken[new-token]');

    await expect(pendingRelease()).resolves.toEqual({ token: TOKEN, since: SINCE.toISOString() });
  });
});

describe('a session that ends without the button', () => {
  test('keeps the token to be let go of, clears the phone and sends the release', async () => {
    await rememberToken(TOKEN);
    release.mockResolvedValue(false);

    await letGoAfterSessionEnded();

    expect(clear).toHaveBeenCalledTimes(1);
    await expect(SecureStore.getItemAsync('push-token')).resolves.toBeNull();
    expect(release).toHaveBeenCalledWith(TOKEN, expect.any(String));
    await expect(pendingRelease()).resolves.toMatchObject({ token: TOKEN });
  });

  test('during the button’s own sign-out does nothing: the button lets go itself', async () => {
    await rememberToken(TOKEN);
    beginSignOut();
    try {
      await letGoAfterSessionEnded();
    } finally {
      endSignOut();
    }

    expect(clear).not.toHaveBeenCalled();
    await expect(pendingRelease()).resolves.toBeNull();
  });

  test('with no token on the phone, keeps nothing and clears nothing', async () => {
    await letGoAfterSessionEnded();

    expect(clear).not.toHaveBeenCalled();
    await expect(pendingRelease()).resolves.toBeNull();
  });
});
