import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { PUSH_CHANNELS, type PushChannel } from './channels';

/**
 * What the phone allows, said the same way on both systems:
 * - `granted`: pushes arrive;
 * - `ask`: never decided — the app may show the system question;
 * - `blocked`: refused; only the phone's settings can change it;
 * - `provisional` (iPhone): delivered quietly to Notification Centre only.
 */
export type PermissionState = 'granted' | 'ask' | 'blocked' | 'provisional';

/**
 * iOS is read from its own status: it reports provisional delivery as
 * 'undetermined'. Android from granted and canAskAgain: Android 13 reports a
 * phone that was never asked as 'denied', with canAskAgain set.
 */
export function permissionState(
  permission: Notifications.NotificationPermissionsStatus,
): PermissionState {
  if (Platform.OS === 'ios' && permission.ios !== undefined) {
    switch (permission.ios.status) {
      case Notifications.IosAuthorizationStatus.NOT_DETERMINED:
        return 'ask';
      case Notifications.IosAuthorizationStatus.DENIED:
        return 'blocked';
      case Notifications.IosAuthorizationStatus.PROVISIONAL:
        return 'provisional';
      default:
        return 'granted';
    }
  }
  if (permission.granted) {
    return 'granted';
  }
  return permission.canAskAgain ? 'ask' : 'blocked';
}

/** Whether the explainer and then the system question may still be shown. */
export function needsAsking(state: PermissionState): boolean {
  return state === 'ask';
}

/** The phone's permission, read now. */
export async function readPermissionState(): Promise<PermissionState> {
  return permissionState(await Notifications.getPermissionsAsync());
}

/**
 * Android channels she switched off in the system settings. A channel's own
 * importance scale is the JS enum (NONE = 2), not the permission's raw
 * Android one — the two are never compared. A channel not made yet is not off.
 */
export async function offChannels(): Promise<PushChannel[]> {
  if (Platform.OS !== 'android') {
    return [];
  }
  const channels = await Promise.all(
    PUSH_CHANNELS.map((id) => Notifications.getNotificationChannelAsync(id)),
  );
  return PUSH_CHANNELS.filter(
    (_id, index) => channels[index]?.importance === Notifications.AndroidImportance.NONE,
  );
}
