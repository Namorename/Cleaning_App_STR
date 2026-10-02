import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { needsAsking, offChannels, permissionState } from '../permission';

/**
 * What the phone allows, said the same way on both systems.
 *
 * The status field alone misleads: Android 13 reports a phone that was never
 * asked as 'denied' (with canAskAgain), and iOS reports provisional delivery
 * as 'undetermined'. So iOS is read from its own status, Android from
 * granted and canAskAgain.
 */

const originalOS = Platform.OS;
const getChannel = Notifications.getNotificationChannelAsync as jest.Mock;

function runOn(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

/** Fields as the native module answers them; the status is a plain string there. */
function permission(fields: object) {
  return {
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
    ...fields,
  } as Notifications.NotificationPermissionsStatus;
}

const ios = (status: Notifications.IosAuthorizationStatus, granted = false) =>
  permission({ granted, ios: { status } as Notifications.NotificationPermissionsStatus['ios'] });

afterEach(() => {
  runOn(originalOS);
  getChannel.mockReset().mockResolvedValue(null);
});

describe('on an iPhone', () => {
  beforeEach(() => runOn('ios'));

  test.each([
    ['never asked', Notifications.IosAuthorizationStatus.NOT_DETERMINED, false, 'ask'],
    ['allowed', Notifications.IosAuthorizationStatus.AUTHORIZED, true, 'granted'],
    ['refused', Notifications.IosAuthorizationStatus.DENIED, false, 'blocked'],
    ['delivering quietly', Notifications.IosAuthorizationStatus.PROVISIONAL, false, 'provisional'],
  ] as const)('%s', (_name, status, granted, expected) => {
    expect(permissionState(ios(status, granted))).toBe(expected);
  });
});

describe('on Android', () => {
  beforeEach(() => runOn('android'));

  test('13 and later, never asked: denied, but may ask', () => {
    expect(permissionState(permission({ status: 'denied', canAskAgain: true }))).toBe('ask');
  });

  test('allowed', () => {
    expect(permissionState(permission({ status: 'granted', granted: true }))).toBe('granted');
  });

  test('refused twice: only the settings can change it', () => {
    expect(permissionState(permission({ status: 'denied', canAskAgain: false }))).toBe('blocked');
  });
});

test('only a phone that may still ask is asked', () => {
  expect(needsAsking('ask')).toBe(true);
  expect(needsAsking('granted')).toBe(false);
  expect(needsAsking('blocked')).toBe(false);
  expect(needsAsking('provisional')).toBe(false);
});

describe('channels switched off', () => {
  test('on Android, a channel set to none is named', async () => {
    runOn('android');
    getChannel.mockImplementation(async (id: string) => ({
      id,
      importance:
        id === 'urgent'
          ? Notifications.AndroidImportance.NONE
          : Notifications.AndroidImportance.DEFAULT,
    }));

    await expect(offChannels()).resolves.toEqual(['urgent']);
  });

  test('a channel not made yet is not reported as off', async () => {
    runOn('android');
    getChannel.mockResolvedValue(null);

    await expect(offChannels()).resolves.toEqual([]);
  });

  test('an iPhone has no channels', async () => {
    runOn('ios');

    await expect(offChannels()).resolves.toEqual([]);
    expect(getChannel).not.toHaveBeenCalled();
  });
});
