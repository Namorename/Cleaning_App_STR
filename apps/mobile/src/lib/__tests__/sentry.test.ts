import * as Sentry from '@sentry/react-native';

import { initSentry, readSentryDsn, reportError } from '../sentry';

/**
 * Crash reports from the field, and nothing about the people in them.
 *
 * Only a release build with a DSN reports; a development run or a build
 * without one sends nothing. Screens show names, addresses and photos, so no
 * personal data, no screenshots, no view hierarchy, no replay — and the
 * sender's IP is not kept.
 */

const DSN = 'https://public@o1.ingest.sentry.io/1';

beforeEach(() => {
  jest.clearAllMocks();
});

test('a release build with a DSN starts reporting, without personal data', () => {
  expect(initSentry(DSN, false)).toBe(true);

  expect(Sentry.init).toHaveBeenCalledWith(
    expect.objectContaining({
      dsn: DSN,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
    }),
  );
  expect(Sentry.setUser).toHaveBeenCalledWith({ ip_address: '0.0.0.0' });
});

test('no tracing: a sample rate of any number, 0 too, would switch it on', () => {
  // With tracing on, every request of the app carries sentry-trace and baggage headers.
  initSentry(DSN, false);

  expect(jest.mocked(Sentry.init).mock.calls[0][0]).not.toHaveProperty('tracesSampleRate');
  expect(jest.mocked(Sentry.init).mock.calls[0][0]).not.toHaveProperty('tracesSampler');
});

test('a development run reports nothing', () => {
  expect(initSentry(DSN, true)).toBe(false);

  expect(Sentry.init).not.toHaveBeenCalled();
});

test('a build without a DSN reports nothing', () => {
  expect(initSentry(undefined, false)).toBe(false);

  expect(Sentry.init).not.toHaveBeenCalled();
});

test('a crash-report address that is not one means no reports, never no app', () => {
  // Pasted into the EAS environment with its quotes, say.
  expect(readSentryDsn('"https://public@o1.ingest.sentry.io/1"')).toBeUndefined();
  // An empty value in an EAS environment means "none", not a malformed URL.
  expect(readSentryDsn('')).toBeUndefined();
  expect(readSentryDsn(undefined)).toBeUndefined();
});

test('a crash-report address is kept when it is one', () => {
  expect(readSentryDsn(DSN)).toBe(DSN);
});

// Crash reports start before anything that reads the app's configuration, so
// a build missing it reports its crash (docs/f11-native-review.md, С-2).
test('crash reports load even when the app configuration cannot', () => {
  const loadWithoutConfiguration = (path: string) => () =>
    jest.isolateModules(() => {
      jest.doMock('@/lib/env', () => {
        throw new Error('Supabase configuration is missing.');
      });
      jest.requireActual(path);
    });

  expect(loadWithoutConfiguration('../sentry')).not.toThrow();
  // The control: a module that does read the configuration fails the same way.
  expect(loadWithoutConfiguration('../online')).toThrow(/configuration is missing/);
});

test('an error is handed to the reporter', () => {
  const error = new Error('drawn wrong');

  reportError(error);

  expect(Sentry.captureException).toHaveBeenCalledWith(error);
});
