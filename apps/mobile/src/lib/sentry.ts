import * as Sentry from '@sentry/react-native';

import { env } from '@/lib/env';

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
 * screenshot, no view hierarchy, no tracing, and the sender's IP is stored as
 * 0.0.0.0 rather than inferred.
 */
export function initSentry(dsn: string | undefined = env.sentryDsn, isDev = __DEV__): boolean {
  if (dsn === undefined || isDev) {
    return false;
  }
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
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
