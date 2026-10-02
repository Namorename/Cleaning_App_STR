import * as Notifications from 'expo-notifications';

import { isShownThread } from './open-thread';
import { readPushData } from './payload';

/**
 * What a push does while the app is open: everything a push in the background
 * does — banner, list, sound — except for a message in the thread she is
 * reading, which is already on her screen. Data the app cannot read is shown:
 * hiding a push is never the safe side. The badge is not kept: nothing in the
 * app would ever clear it.
 */
export function foregroundBehavior(data: unknown): Notifications.NotificationBehavior {
  const isQuiet = isShownThread(readPushData(data));
  return {
    shouldShowBanner: !isQuiet,
    shouldShowList: !isQuiet,
    shouldPlaySound: !isQuiet,
    shouldSetBadge: false,
  };
}

/**
 * Installed once, from the app's entry (index.js), before anything renders.
 * Without a handler SDK 57 shows nothing while the app is open; the answer is
 * read from memory, never the network, because it has three seconds.
 */
export function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) =>
      foregroundBehavior(notification.request.content.data),
  });
}
