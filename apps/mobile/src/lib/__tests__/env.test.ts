import type * as EnvModule from '../env';

/**
 * The configuration check runs at import time, before any translation is
 * loaded, and its words go to the developer's terminal and the logs: English,
 * like every other error message in the code.
 */

const SAVED = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
};

afterEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = SAVED.url;
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = SAVED.key;
  if (SAVED.dsn === undefined) {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  } else {
    process.env.EXPO_PUBLIC_SENTRY_DSN = SAVED.dsn;
  }
});

/** A fresh import, so the check runs again against the environment as it is now. */
function importEnv(): typeof EnvModule {
  let loaded: typeof EnvModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<typeof EnvModule>('../env');
  });
  if (loaded === undefined) {
    throw new Error('The module was not imported');
  }
  return loaded;
}

test('reads the public configuration it was given', () => {
  // Act
  const { env } = importEnv();

  // Assert
  expect(env.supabaseUrl).toBe('https://project.supabase.co');
});

test('refuses to start without it, in English, and says where the values come from', () => {
  // Arrange
  delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Act / Assert
  expect(importEnv).toThrow(/apps\/mobile\/\.env\.example/);
  expect(importEnv).toThrow(/^[\x20-\x7E]+$/);
});

// The crash-report address is read by lib/sentry.ts itself, not here: crash
// reports start before this check can throw (docs/f11-native-review.md, С-2).
test('the configuration does not carry the crash-report address', () => {
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@o1.ingest.sentry.io/1';

  expect(importEnv().env).not.toHaveProperty('sentryDsn');
});
