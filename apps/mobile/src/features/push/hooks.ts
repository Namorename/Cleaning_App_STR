import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';

import { fetchTask } from '@/features/tasks/api';
import { reportError, reportUnlessOffline } from '@/lib/sentry';

import { ensureChannels } from './channels';
import { destinationOf, staleAfter } from './destination';
import { isNewTap } from './followed-taps';
import { useLastResponse } from './last-response';
import { readPushData, type PushData } from './payload';
import { needsAsking, readPermissionState } from './permission';
import { registerThisPhone } from './registration';
import { isRegisteredFor } from './token-store';

const hasPushes = Platform.OS !== 'web';

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
    // Every token fetch fires this event too, including the registration's
    // own; only once this run's registration went through is it news.
    const tokens = Notifications.addPushTokenListener((device) => {
      if (isRegisteredFor(userId)) {
        register(device);
      }
    });
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

/**
 * How long a tap on «moved» waits to learn whether the cleaning is still
 * hers. Longer, and a connection that passes nothing would hold the tap for
 * minutes, then jump over whatever she is doing by then (review П-2); the
 * cleaning itself opens instead, as without signal.
 */
export const TAP_LOOKUP_TIMEOUT_MS = 3_000;

function findTaskInTime(taskId: string): ReturnType<typeof fetchTask> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The moved cleaning was not found in time')),
      TAP_LOOKUP_TIMEOUT_MS,
    );
    fetchTask(taskId).then(
      (task) => {
        clearTimeout(timer);
        resolve(task);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function follow(client: QueryClient, data: PushData): Promise<void> {
  // Marked stale at once, refetched in the background: the screen it opens
  // does not draw the copy cached before the push, and the tap does not wait
  // for a list to come back over a weak signal.
  void refresh(client, data);
  const destination = await destinationOf(data, findTaskInTime);
  if (destination.pathname === '/(tabs)') {
    // The list itself, not a second copy of it over the screen she was on.
    if (router.canDismiss()) {
      router.dismissAll();
    }
  }
  router.navigate(destination);
}

/**
 * Opens what a tapped push is about — from a cold start as well as from the
 * background. Called from the tabs, where the navigator is up and her session
 * has been read: from the root it would race the redirect to sign-in. A tap is
 * followed once across runs of the app (followed-taps.ts), and cleared either
 * way — a tap kept would hide a later one with the same identifier. Keyed on
 * the delivery, not the identifier alone: pushes about one cleaning or thread
 * share their identifier (the collapse key), and a newer one is a tap of its
 * own. A push the app cannot read only opens the app.
 */
export function usePushTaps(userId: string | null): void {
  const client = useQueryClient();
  const last = useLastResponse();

  useEffect(() => {
    if (userId === null || last === undefined || last === null) {
      return;
    }
    if (last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
      return;
    }
    const tapId = `${last.notification.request.identifier}@${last.notification.date}`;
    Notifications.clearLastNotificationResponse();
    const data = readPushData(last.notification.request.content.data);
    isNewTap(tapId)
      .then((isNew) => (isNew && data !== null ? follow(client, data) : undefined))
      .catch(reportError);
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
