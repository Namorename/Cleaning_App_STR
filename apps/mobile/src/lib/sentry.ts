import * as Sentry from '@sentry/react-native';

import { env } from '@/lib/env';
import { isNetworkError } from '@/lib/online';

/**
 * Crash reports from the field.
 *
 * Started from the app's entry (index.js) before anything renders, and only
 * in a release build that was given a DSN: a development run, a test, or a
 * build without one sends nothing, and every call below is then a no-op.
 *
 * What is sent is the error and its stack, never the people in it. Screens
 * show names, addresses and photos, so Sentry's own Expo example — personal
 * data on, screenshots, replay — is not followed: no personal data, no
 * screenshot, no view hierarchy, and the sender's IP is stored as 0.0.0.0
 * rather than inferred. No tracing either — and that means no sample rate at
 * all: any number, 0 included, switches tracing on, and every request of the
 * app would carry Sentry's trace headers.
 */
export function initSentry(dsn: string | undefined = env.sentryDsn, isDev = __DEV__): boolean {
  if (dsn === undefined || isDev) {
    return false;
  }
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
  });
  Sentry.setUser({ ip_address: '0.0.0.0' });
  return true;
}

/** An error the app caught and survived, for the report; a no-op when reporting is off. */
export function reportError(error: unknown): void {
  Sentry.captureException(error);
}

/** The same, except no signal: that is the stairwell, not a fault — the next try goes through. */
export function reportUnlessOffline(error: unknown): void {
  if (!isNetworkError(error)) {
    reportError(error);
  }
}
