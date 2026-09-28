import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';

import { fetchTask } from '@/features/tasks/api';
import { isNetworkError } from '@/lib/online';
import { reportError } from '@/lib/sentry';

import { ensureChannels } from './channels';
import { destinationOf, staleAfter } from './destination';
import { readPushData, type PushData } from './payload';
import { needsAsking, readPermissionState } from './permission';
import { registerThisPhone } from './registration';

const hasPushes = Platform.OS !== 'web';

/** No signal is the stairwell, not a fault: the next start registers again. */
function reportUnlessOffline(error: unknown): void {
  if (!isNetworkError(error)) {
    reportError(error);
  }
}

/**
 * Keeps this phone registered for whoever is signed in on it: at sign-in, when
 * the app comes back to the front (she may have allowed pushes in the system
 * settings meanwhile), and when the system hands over a new device token.
 * Renames the Android channels when her language changes.
 */
export function usePushRegistration(userId: string | null): void {
  const { i18n } = useTranslation();
  const language = i18n.language;

  useEffect(() => {
    if (!hasPushes || userId === null) {
      return;
    }
    const register = (device?: Notifications.DevicePushToken) => {
      const registering =
        device === undefined ? registerThisPhone(userId) : registerThisPhone(userId, device);
      registering.catch(reportUnlessOffline);
    };
    register();
    const tokens = Notifications.addPushTokenListener(register);
    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        register();
      }
    });
    return () => {
      tokens.remove();
      appState.remove();
    };
  }, [userId]);

  useEffect(() => {
    if (hasPushes) {
      ensureChannels().catch(reportError);
    }
  }, [language]);
}

function refresh(client: QueryClient, data: PushData | null): Promise<void[]> {
  return Promise.all(staleAfter(data).map((queryKey) => client.invalidateQueries({ queryKey })));
}

/**
 * A push arriving while the app is open makes stale what it is about, so the
 * screen underneath shows it without a pull. In the background nothing is
 * needed: the lists refresh when the app comes back to the front.
 */
export function usePushRefresh(): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!hasPushes) {
      return;
    }
    const received = Notifications.addNotificationReceivedListener((notification) => {
      void refresh(client, readPushData(notification.request.content.data));
    });
    return () => received.remove();
  }, [client]);
}

/** Taps already followed in this run: the tabs draw again after sign-in or a retry. */
const followedTaps = new Set<string>();

async function follow(client: QueryClient, data: PushData): Promise<void> {
  // Stale first: the screen it opens must not draw the copy cached before the push.
  await refresh(client, data);
  const destination = await destinationOf(data, fetchTask);
  if (destination.pathname === '/(tabs)') {
    router.navigate(destination);
  } else {
    router.push(destination);
  }
}

/**
 * Opens what a tapped push is about — from a cold start as well as from the
 * background. Called from the tabs, where the navigator is up and her session
 * has been read: from the root it would race the redirect to sign-in. A tap is
 * followed once, and cleared, so drawing the tabs again does not follow it
 * again. A push the app cannot read only opens the app.
 */
export function usePushTaps(userId: string | null): void {
  const client = useQueryClient();
  const last = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (userId === null || last === undefined || last === null) {
      return;
    }
    if (last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
      return;
    }
    const tapId = last.notification.request.identifier;
    if (followedTaps.has(tapId)) {
      return;
    }
    followedTaps.add(tapId);
    Notifications.clearLastNotificationResponse();
    const data = readPushData(last.notification.request.content.data);
    if (data !== null) {
      follow(client, data).catch(reportError);
    }
  }, [client, last, userId]);
}

/** Shown once a run: "not now" is respected until the app is started again. */
let hasPrompted = false;

/**
 * Before the system asks, the app says why (app/notifications.tsx): the
 * system question comes once on an iPhone and twice on Android, and a "no"
 * without a reason is the usual answer. Only on a phone that may still ask;
 * a refusal is the Settings notice's to deal with.
 */
export function usePermissionPrompt(userId: string | null): void {
  useEffect(() => {
    if (!hasPushes || !Device.isDevice || userId === null || hasPrompted) {
      return;
    }
    let isCurrent = true;
    readPermissionState()
      .then((state) => {
        if (isCurrent && !hasPrompted && needsAsking(state)) {
          hasPrompted = true;
          router.push('/notifications');
        }
      })
      .catch(reportError);
    return () => {
      isCurrent = false;
    };
  }, [userId]);
}
