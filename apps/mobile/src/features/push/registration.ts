import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { deviceLanguage } from '@/i18n';

import { registerPushToken } from './api';
import { ensureChannels } from './channels';
import { isRegisteredFor, rememberRegistration } from './token-store';

/**
 * Registers this phone for the pushes of whoever is signed in on it.
 *
 * Only once the phone allows pushes: asking is the explainer's job
 * (permission-explainer.tsx), and a token asked for before that would be a
 * token nothing reaches. Channels come first — on Android a push lands only
 * in a channel the phone has. Called on sign-in and whenever the app comes
 * back to the front (she may have allowed pushes in the system settings);
 * after one success in a run it asks nothing more, unless the system hands
 * over a new device token.
 *
 * Resolves to whether the phone is registered; a refusal from Expo or the
 * server is thrown for the caller to report.
 */
export async function registerThisPhone(
  userId: string,
  devicePushToken?: Notifications.DevicePushToken,
): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) {
    return false;
  }
  if (devicePushToken === undefined && isRegisteredFor(userId)) {
    return true;
  }
  await ensureChannels();
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    return false;
  }
  const projectId = easProjectId();
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    devicePushToken === undefined ? { projectId } : { projectId, devicePushToken },
  );
  await registerPushToken({
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    language: deviceLanguage(),
    appVersion: Constants.expoConfig?.version ?? null,
  });
  await rememberRegistration(token, userId);
  return true;
}

/** The EAS project the token is issued for (app.json, extra.eas.projectId). */
function easProjectId(): string {
  const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== 'string' || projectId === '') {
    throw new Error('The EAS project id is missing from the app config');
  }
  return projectId;
}
