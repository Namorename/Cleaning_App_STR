import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { deviceLanguage } from '@/i18n';

import { registerPushToken } from './api';
import { ensureChannels } from './channels';
import { flushPendingRelease, keepReleasePending, settlePendingRelease } from './pending-release';
import {
  isRegisteredFor,
  markRegistered,
  registrationOnItsWay,
  rememberToken,
  signOutsSoFar,
  trackRegistration,
} from './token-store';

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
 *
 * One registration at a time serves everyone who asks: after the first
 * «Allow» the explainer and the app's return to the front both ask at once
 * (docs/f11-native-review.md, Т-1). Signing out waits for the one on its way.
 */
export function registerThisPhone(
  userId: string,
  devicePushToken?: Notifications.DevicePushToken,
): Promise<boolean> {
  const onItsWay = devicePushToken === undefined ? registrationOnItsWay(userId) : null;
  if (onItsWay !== null) {
    return onItsWay;
  }
  const registration = register(userId, devicePushToken);
  trackRegistration(userId, registration);
  return registration;
}

async function register(
  userId: string,
  devicePushToken?: Notifications.DevicePushToken,
): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) {
    return false;
  }
  if (devicePushToken === undefined && isRegisteredFor(userId)) {
    return true;
  }
  // The token takes seconds on a weak signal; if she signs out meanwhile, a
  // registration landing afterwards would give the phone back to her.
  const signOuts = signOutsSoFar();
  await ensureChannels();
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    return false;
  }
  const projectId = easProjectId();
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    devicePushToken === undefined ? { projectId } : { projectId, devicePushToken },
  );
  if (signOutsSoFar() !== signOuts) {
    return false;
  }
  // Kept before the server hears of it: a sign-out while the call is on its
  // way lets go of this token rather than finding nothing.
  await rememberToken(token);
  await registerPushToken({
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    language: deviceLanguage(),
    appVersion: Constants.expoConfig?.version ?? null,
  });
  if (signOutsSoFar() !== signOuts) {
    // She signed out while the call was out: it bound the token to her again
    // after the sign-out's release. It waits to be let go of once more, from
    // now (review of 86122ac).
    await keepReleasePending(token).catch(() => undefined);
    void flushPendingRelease();
    return false;
  }
  // The binding moved to whoever registered: a release of this token kept
  // after a sign-out nobody heard has nothing left to undo.
  await settlePendingRelease(token).catch(() => undefined);
  markRegistered(userId);
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
