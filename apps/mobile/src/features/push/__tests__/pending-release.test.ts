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
import {
  beginSignOut,
  endSignOut,
  markRegistered,
  rememberToken,
  unmarkRegistered,
} from '../token-store';

/**
 * A phone let go of after a sign-out it could not confirm (owner's words of
 * 2026-10-11, 00:40 and 2026-10-12, 18:20). Without signal the sign-out removes
 * her session all the same, and the server goes on sending her pushes to the
 * phone; a session that ends without the button never lets go at all. The
 * phone keeps the token and whose it is — the one signing out — as "to be let
 * go of", and sends release_push_token(token, profile_id), no session needed,
 * when it can: at the start, on coming back to the app, on coming back online
 * (hooks.ts). The server lets go only while the token is still hers. No clock.
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
const ANNA = 'a8f12001-0000-4000-8000-000000000001';
const BARA = 'a8f12002-0000-4000-8000-000000000002';

beforeEach(async () => {
  await SecureStore.deleteItemAsync('push-token-release');
  await SecureStore.deleteItemAsync('push-token');
  await SecureStore.deleteItemAsync('push-token-owner');
  unmarkRegistered();
  release.mockReset().mockResolvedValue(true);
  clear.mockClear();
});

describe('what is kept', () => {
  test('the token and whose it is', async () => {
    await keepReleasePending(TOKEN, ANNA);

    await expect(pendingRelease()).resolves.toEqual({ token: TOKEN, profileId: ANNA });
  });

  test('the phone’s own token, with the one it was registered for: the one signing out', async () => {
    await rememberToken(TOKEN, ANNA);

    await keepThisPhonePending();

    await expect(pendingRelease()).resolves.toEqual({ token: TOKEN, profileId: ANNA });
  });

  test('a token kept by a build that did not name its owner: the one registered in this run', async () => {
    await SecureStore.setItemAsync('push-token', TOKEN);
    markRegistered(ANNA);

    await keepThisPhonePending();

    await expect(pendingRelease()).resolves.toEqual({ token: TOKEN, profileId: ANNA });
  });

  test('nothing, when the phone had no token', async () => {
    await keepThisPhonePending();

    await expect(pendingRelease()).resolves.toBeNull();
  });

  test('a release kept by the earlier draft, with a moment and no name, is no release, and goes', async () => {
    await SecureStore.setItemAsync(
      'push-token-release',
      JSON.stringify({ token: TOKEN, since: '2026-10-11T07:00:00.000Z' }),
    );

    await expect(pendingRelease()).resolves.toBeNull();
    await expect(SecureStore.getItemAsync('push-token-release')).resolves.toBeNull();
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

  test('heard: the server is asked with the token and whose it is, and it is forgotten', async () => {
    await keepReleasePending(TOKEN, ANNA);

    await flushPendingRelease();

    expect(release).toHaveBeenCalledWith(TOKEN, ANNA);
    await expect(pendingRelease()).resolves.toBeNull();
  });

  test('not heard (no signal, no answer, a refusal): it stays, and the next chance names her again', async () => {
    release.mockResolvedValue(false);
    await keepReleasePending(TOKEN, ANNA);

    await flushPendingRelease();
    await flushPendingRelease(BARA);

    expect(release).toHaveBeenNthCalledWith(1, TOKEN, ANNA);
    expect(release).toHaveBeenNthCalledWith(2, TOKEN, ANNA);
    await expect(pendingRelease()).resolves.toEqual({ token: TOKEN, profileId: ANNA });
  });

  // With no clock to tell a fresh binding from the one she left, the phone
  // itself knows: she is signed in on it again, and her binding is wanted.
  test('she signed in on the phone again: nothing is let go of, and nothing waits', async () => {
    await keepReleasePending(TOKEN, ANNA);

    await flushPendingRelease(ANNA);

    expect(release).not.toHaveBeenCalled();
    await expect(pendingRelease()).resolves.toBeNull();
  });

  test('asked twice at once, it goes once', async () => {
    await keepReleasePending(TOKEN, ANNA);

    await Promise.all([flushPendingRelease(), flushPendingRelease()]);

    expect(release).toHaveBeenCalledTimes(1);
  });

  // Owner's word of 2026-10-12: a send asked for while one is on its way is
  // not lost until the next start — it goes right after.
  test('asked again while one is on its way: it goes right after, with what waits then', async () => {
    await keepReleasePending(TOKEN, ANNA);
    let askedMeanwhile: Promise<void> | null = null;
    release.mockImplementationOnce(async () => {
      await keepReleasePending('ExponentPushToken[next-phone]', BARA);
      askedMeanwhile = flushPendingRelease();
      return true;
    });

    await flushPendingRelease();
    await askedMeanwhile;

    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenNthCalledWith(2, 'ExponentPushToken[next-phone]', BARA);
    await expect(pendingRelease()).resolves.toBeNull();
  });

  test('a release kept meanwhile for a later sign-out is not forgotten with the earlier one', async () => {
    await keepReleasePending(TOKEN, ANNA);
    release
      .mockImplementationOnce(async () => {
        await keepReleasePending('ExponentPushToken[next-phone]', BARA);
        return true;
      })
      .mockResolvedValueOnce(false);

    await flushPendingRelease();

    await expect(pendingRelease()).resolves.toEqual({
      token: 'ExponentPushToken[next-phone]',
      profileId: BARA,
    });
  });

  test('never throws: a store that fails is the next chance’s', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('keychain locked'));

    await expect(flushPendingRelease()).resolves.toBeUndefined();
  });

  test('the web build has no pushes, and nothing to let go of', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    await keepReleasePending(TOKEN, ANNA);

    await flushPendingRelease();

    expect(release).not.toHaveBeenCalled();
    os.restore();
  });
});

describe('a registration that lands', () => {
  test('settles the release of its own token: the binding moved anyway', async () => {
    await keepReleasePending(TOKEN, ANNA);

    await settlePendingRelease(TOKEN);

    await expect(pendingRelease()).resolves.toBeNull();
  });

  test('leaves the release of another token: that binding is still the old one', async () => {
    await keepReleasePending(TOKEN, ANNA);

    await settlePendingRelease('ExponentPushToken[new-token]');

    await expect(pendingRelease()).resolves.toEqual({ token: TOKEN, profileId: ANNA });
  });
});

describe('a session that ends without the button', () => {
  test('keeps the token and whose it was, clears the phone and sends the release', async () => {
    await rememberToken(TOKEN, ANNA);
    release.mockResolvedValue(false);

    await letGoAfterSessionEnded();

    expect(clear).toHaveBeenCalledTimes(1);
    await expect(SecureStore.getItemAsync('push-token')).resolves.toBeNull();
    await expect(SecureStore.getItemAsync('push-token-owner')).resolves.toBeNull();
    expect(release).toHaveBeenCalledWith(TOKEN, ANNA);
    await expect(pendingRelease()).resolves.toEqual({ token: TOKEN, profileId: ANNA });
  });

  test('during the button’s own sign-out does nothing: the button lets go itself', async () => {
    await rememberToken(TOKEN, ANNA);
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
