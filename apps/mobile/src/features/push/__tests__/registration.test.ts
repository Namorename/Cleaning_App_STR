import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { registerPushToken } from '../api';
import { registerThisPhone } from '../registration';
import { forgetRegistration } from '../token-store';

/**
 * A phone is registered for her pushes once it allows them: channels first
 * (Android shows nothing in a channel it does not have), then Expo's token,
 * then the server. Never on a simulator, never on the web, never before she
 * said yes — the explainer asks, this does not.
 */

jest.mock('../api', () => ({ registerPushToken: jest.fn(async () => undefined) }));

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
