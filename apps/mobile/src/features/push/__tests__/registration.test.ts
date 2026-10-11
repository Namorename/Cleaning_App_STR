import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { registerPushToken } from '../api';
import { flushPendingRelease, keepReleasePending, settlePendingRelease } from '../pending-release';
import { registerThisPhone } from '../registration';
import { forgetRegistration, isRegisteredFor } from '../token-store';

/** Lets pending promises run until `check` holds; a stuck test fails on its timeout. */
async function until(check: () => boolean): Promise<void> {
  while (!check()) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * A phone is registered for her pushes once it allows them: channels first
 * (Android shows nothing in a channel it does not have), then Expo's token,
 * then the server. Never on a simulator, never on the web, never before she
 * said yes — the explainer asks, this does not.
 */

jest.mock('../api', () => ({ registerPushToken: jest.fn(async () => undefined) }));
jest.mock('../pending-release', () => ({
  settlePendingRelease: jest.fn(async () => undefined),
  keepReleasePending: jest.fn(async () => undefined),
  flushPendingRelease: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.1.0', extra: { eas: { projectId: 'project-1' } } } },
}));

const mockRegister = jest.mocked(registerPushToken);
const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const getToken = Notifications.getExpoPushTokenAsync as jest.Mock;
const setChannel = Notifications.setNotificationChannelAsync as jest.Mock;
const originalOS = Platform.OS;

function runOn(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

const notAsked = { status: 'denied', granted: false, canAskAgain: true, expires: 'never' };

beforeEach(async () => {
  runOn('android');
  mockRegister.mockClear();
  getToken.mockClear();
  setChannel.mockClear();
  getPermissions.mockClear();
  await forgetRegistration();
});

afterEach(() => {
  runOn(originalOS);
  jest.restoreAllMocks();
});

test('registers the phone with its token, platform, language and version, and remembers it', async () => {
  await expect(registerThisPhone('me')).resolves.toBe(true);

  expect(getToken).toHaveBeenCalledWith({ projectId: 'project-1' });
  expect(mockRegister).toHaveBeenCalledWith({
    token: 'ExponentPushToken[test]',
    platform: 'android',
    language: 'ru',
    appVersion: '1.1.0',
  });
  await expect(SecureStore.getItemAsync('push-token')).resolves.toBe('ExponentPushToken[test]');
});

// Owner's word of 2026-10-11, 00:40: a token waiting to be let go of after a
// sign-out nobody heard is settled by a registration of the same token — the
// binding moved to whoever registered.
test('a registration that lands settles the release its token was waiting for', async () => {
  jest.mocked(settlePendingRelease).mockClear();

  await registerThisPhone('me');

  expect(settlePendingRelease).toHaveBeenCalledWith('ExponentPushToken[test]');
});

test('a registration the server refused settles nothing', async () => {
  jest.mocked(settlePendingRelease).mockClear();
  mockRegister.mockRejectedValueOnce(new Error('refused'));

  await expect(registerThisPhone('me')).rejects.toThrow('refused');

  expect(settlePendingRelease).not.toHaveBeenCalled();
});

test('the channels exist before the token is asked for', async () => {
  const order: string[] = [];
  setChannel.mockImplementation(async () => {
    order.push('channel');
    return null;
  });
  getToken.mockImplementationOnce(async () => {
    order.push('token');
    return { type: 'expo', data: 'ExponentPushToken[test]' };
  });

  await registerThisPhone('me');

  expect(order).toEqual(['channel', 'channel', 'token']);
});

test('before she allows pushes, nothing is asked of Expo or the server', async () => {
  getPermissions.mockResolvedValueOnce(notAsked);

  await expect(registerThisPhone('me')).resolves.toBe(false);

  expect(getToken).not.toHaveBeenCalled();
  expect(mockRegister).not.toHaveBeenCalled();
});

test('a simulator has no token to register', async () => {
  jest.replaceProperty(Device, 'isDevice', false);

  await expect(registerThisPhone('me')).resolves.toBe(false);

  expect(getToken).not.toHaveBeenCalled();
});

test('the web build has no pushes', async () => {
  runOn('web');

  await expect(registerThisPhone('me')).resolves.toBe(false);

  expect(getPermissions).not.toHaveBeenCalled();
});

test('once registered in this run, coming back to the app asks the server nothing again', async () => {
  await registerThisPhone('me');
  mockRegister.mockClear();

  await registerThisPhone('me');

  expect(mockRegister).not.toHaveBeenCalled();
});

test('someone else signing in on the same phone registers it for her', async () => {
  await registerThisPhone('me');
  mockRegister.mockClear();

  await registerThisPhone('colleague');

  expect(mockRegister).toHaveBeenCalledTimes(1);
});

test('a new token from the system is registered even when the phone already was', async () => {
  await registerThisPhone('me');
  mockRegister.mockClear();
  const device = { type: 'android' as const, data: 'fcm-2' };

  await registerThisPhone('me', device);

  expect(getToken).toHaveBeenLastCalledWith({ projectId: 'project-1', devicePushToken: device });
  expect(mockRegister).toHaveBeenCalledTimes(1);
});

test('after signing out, signing back in registers again', async () => {
  await registerThisPhone('me');
  await forgetRegistration();
  mockRegister.mockClear();

  await registerThisPhone('me');

  expect(mockRegister).toHaveBeenCalledTimes(1);
});

test('a refusal is not remembered as a registration', async () => {
  mockRegister.mockRejectedValueOnce(new Error('refused'));

  await expect(registerThisPhone('me')).rejects.toThrow('refused');
  mockRegister.mockClear();

  await registerThisPhone('me');
  expect(mockRegister).toHaveBeenCalledTimes(1);
});

test('a registration still on its way when she signs out does not land after it', async () => {
  // The token comes from Apple or Google, then Expo: seconds on a weak signal.
  getToken.mockImplementationOnce(async () => {
    await forgetRegistration();
    return { type: 'expo', data: 'ExponentPushToken[test]' };
  });

  await expect(registerThisPhone('me')).resolves.toBe(false);

  expect(mockRegister).not.toHaveBeenCalled();
});

// Review of 86122ac: a registration whose server call was already out when
// she signed out lands after the sign-out's release — the token is bound to
// her again, and must wait to be let go of once more, not be settled.
test('a registration landing on the server after a sign-out keeps its token waiting to be let go of', async () => {
  jest.mocked(settlePendingRelease).mockClear();
  mockRegister.mockImplementationOnce(async () => {
    await forgetRegistration();
  });

  await expect(registerThisPhone('me')).resolves.toBe(false);

  expect(settlePendingRelease).not.toHaveBeenCalled();
  expect(keepReleasePending).toHaveBeenCalledWith('ExponentPushToken[test]');
  expect(flushPendingRelease).toHaveBeenCalled();
});

// After the first «Allow» the system dialog closes and the app is back in
// front: the explainer and the app's own return both register then
// (docs/f11-native-review.md, Т-1).
test('two registrations asked at once are one: one token, one call to the server', async () => {
  const both = await Promise.all([registerThisPhone('me'), registerThisPhone('me')]);

  expect(both).toEqual([true, true]);
  expect(getToken).toHaveBeenCalledTimes(1);
  expect(mockRegister).toHaveBeenCalledTimes(1);
});

// A sign-out while the server call is on its way must find the token to let go
// of (Т-1): it is kept before the call, and counts as hers only after it.
test('the token is kept on the phone before the server hears of it', async () => {
  let answer: () => void = () => undefined;
  mockRegister.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        answer = resolve;
      }),
  );

  const registering = registerThisPhone('me');
  await until(() => mockRegister.mock.calls.length > 0);

  await expect(SecureStore.getItemAsync('push-token')).resolves.toBe('ExponentPushToken[test]');
  expect(isRegisteredFor('me')).toBe(false);

  answer();
  await expect(registering).resolves.toBe(true);
  expect(isRegisteredFor('me')).toBe(true);
});

test('signed out while the server call was on its way: the phone does not count as hers', async () => {
  let answer: () => void = () => undefined;
  mockRegister.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        answer = resolve;
      }),
  );

  const registering = registerThisPhone('me');
  await until(() => mockRegister.mock.calls.length > 0);
  await forgetRegistration();
  answer();

  await expect(registering).resolves.toBe(false);
  expect(isRegisteredFor('me')).toBe(false);
});
