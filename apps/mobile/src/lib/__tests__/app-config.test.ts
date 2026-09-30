import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SUPPORTED_LANGUAGES } from '@str-ops/shared';
import type { ExpoConfig } from 'expo/config';

import { PUSH_CHANNELS } from '@/features/push/channels';

import enLocale from '../../../../../packages/shared/src/i18n/locales/en.json';
import appJson from '../../../app.json';
import easJson from '../../../eas.json';
import packageJson from '../../../package.json';
import resolveConfig, { checkBuildEnv } from '../../../app.config';

/**
 * The native build 1.1.0 as the config describes it. A mistake here is found
 * only after a forty-minute build — or by App Review — so it is read here.
 */

const APP_ROOT = join(__dirname, '../../..');

type Plugin = string | [string, Record<string, unknown>];

function resolve(env: Record<string, string | undefined> = {}): ExpoConfig {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    }
  }
  try {
    // app.json's JSON types are wider than ExpoConfig's unions; Expo reads it the same way.
    return resolveConfig({ config: appJson.expo } as unknown as Parameters<
      typeof resolveConfig
    >[0]);
  } finally {
    process.env = saved;
  }
}

function plugin(config: ExpoConfig, name: string): Record<string, unknown> | undefined {
  const found = (config.plugins as Plugin[]).find((entry) =>
    Array.isArray(entry) ? entry[0] === name : entry === name,
  );
  return Array.isArray(found) ? found[1] : undefined;
}

test('the build is 1.1.0, and OTA updates follow the version', () => {
  const config = resolve();

  expect(config.version).toBe('1.1.0');
  expect(config.runtimeVersion).toEqual({ policy: 'appVersion' });
});

test('notifications: the default channel is one the app makes, and the icon exists', () => {
  const notifications = plugin(resolve(), 'expo-notifications');

  expect(PUSH_CHANNELS).toContain(notifications?.defaultChannel);
  expect(existsSync(join(APP_ROOT, String(notifications?.icon)))).toBe(true);
});

test('Sentry: the plugin entry the source-map upload looks for, and no token in the config', () => {
  const config = resolve({ SENTRY_ORG: 'org', SENTRY_PROJECT: 'project' });
  const sentry = plugin(config, '@sentry/react-native/expo');

  expect(sentry).toEqual(
    expect.objectContaining({ organization: 'org', project: 'project', url: 'https://sentry.io/' }),
  );
  expect(sentry).not.toHaveProperty('authToken');
  expect(config.plugins).not.toContain('@sentry/react-native');
});

// With the token but no organisation or project, the upload fails at the very
// end of an iOS build (docs/f11-native-review.md, С-3).
test('Sentry: source maps are uploaded only when token, organisation and project are all there', () => {
  const all = { SENTRY_AUTH_TOKEN: 'token', SENTRY_ORG: 'org', SENTRY_PROJECT: 'project' };
  const sentry = (env: Record<string, string | undefined>) =>
    plugin(resolve(env), '@sentry/react-native/expo');

  expect(sentry(all)?.disableAutoUpload).toBe(false);
  expect(sentry({ ...all, SENTRY_AUTH_TOKEN: undefined })?.disableAutoUpload).toBe(true);
  expect(sentry({ ...all, SENTRY_ORG: undefined })?.disableAutoUpload).toBe(true);
  expect(sentry({ ...all, SENTRY_PROJECT: undefined })?.disableAutoUpload).toBe(true);
});

describe('an EAS build checks its environment before it starts (review С-2, С-3)', () => {
  const complete = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable',
    EXPO_PUBLIC_SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
    SENTRY_AUTH_TOKEN: 'token',
    SENTRY_ORG: 'org',
    SENTRY_PROJECT: 'project',
  };

  test('a complete environment passes quietly', () => {
    expect(checkBuildEnv(complete)).toEqual({ errors: [], warnings: [] });
  });

  test('without the address or key of the cloud the build is refused: the app would crash at start', () => {
    const { errors } = checkBuildEnv({ ...complete, EXPO_PUBLIC_SUPABASE_URL: undefined });

    expect(errors).toEqual([expect.stringContaining('EXPO_PUBLIC_SUPABASE_URL')]);
    expect(checkBuildEnv({ ...complete, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' }).errors).toEqual(
      [expect.stringContaining('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY')],
    );
  });

  test('half a source-map upload is refused, naming what is missing', () => {
    const { errors } = checkBuildEnv({ ...complete, SENTRY_ORG: undefined });

    expect(errors).toEqual([expect.stringContaining('SENTRY_ORG')]);
  });

  test('a build without Sentry is allowed, and says what it will lack', () => {
    const { errors, warnings } = checkBuildEnv({
      ...complete,
      EXPO_PUBLIC_SENTRY_DSN: undefined,
      SENTRY_AUTH_TOKEN: undefined,
      SENTRY_ORG: undefined,
      SENTRY_PROJECT: undefined,
    });

    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  test('resolving the config in an EAS build throws on an error, and not on a warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(() =>
        resolve({ ...complete, EAS_BUILD: 'true', EXPO_PUBLIC_SUPABASE_URL: undefined }),
      ).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
      expect(() =>
        resolve({ ...complete, EAS_BUILD: 'true', EXPO_PUBLIC_SENTRY_DSN: undefined }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalled();
      // A local run (expo start, the tests) is not held to it.
      expect(() =>
        resolve({ ...complete, EAS_BUILD: undefined, SENTRY_ORG: undefined }),
      ).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });
});

// An environment chosen implicitly cannot be checked from the repository (С-2);
// what shares the preview channel is published with --environment preview.
test('every build profile names its EAS environment, and the preview channel builds from preview', () => {
  for (const profile of Object.values(easJson.build) as {
    channel?: string;
    environment?: string;
  }[]) {
    expect(['development', 'preview', 'production']).toContain(profile.environment);
    if (profile.channel === 'preview') {
      expect(profile.environment).toBe('preview');
    }
  }
});

// The first iOS build: the system asks in her language, and so does the app's
// own reason for asking (review С-4).
test('iOS: the app declares its three languages', () => {
  const localization = plugin(resolve(), 'expo-localization') as
    { supportedLocales?: { ios?: string[] } } | undefined;

  expect([...(localization?.supportedLocales?.ios ?? [])].sort()).toEqual(
    [...SUPPORTED_LANGUAGES].sort(),
  );
});

test('iOS: every permission question is written in each of her languages', () => {
  const config = resolve();
  const picker = plugin(config, 'expo-image-picker');
  const english: Record<string, unknown> = {
    NSCameraUsageDescription: picker?.cameraPermission,
    NSMicrophoneUsageDescription: picker?.microphonePermission,
    NSPhotoLibraryUsageDescription: picker?.photosPermission,
  };

  for (const language of SUPPORTED_LANGUAGES.filter((one) => one !== 'en')) {
    const strings = (config.locales as Record<string, Record<string, unknown>> | undefined)?.[
      language
    ];
    for (const [key, value] of Object.entries(english)) {
      expect(typeof strings?.[key]).toBe('string');
      expect(strings?.[key]).not.toBe(value);
    }
  }
});

// The English reasons are app.json's; the shared locales hold them too, so the
// three languages cannot drift apart (the key parity test covers the rest).
test('iOS: the English permission reasons are the ones in the shared locales', () => {
  const picker = plugin(resolve(), 'expo-image-picker');

  expect(enLocale.iosPermissions).toEqual({
    camera: picker?.cameraPermission,
    microphone: picker?.microphonePermission,
    photos: picker?.photosPermission,
  });
});

test('Android: the Firebase file comes from the EAS file variable, or a local file', () => {
  expect(
    resolve({ GOOGLE_SERVICES_JSON: '/tmp/eas/google.json' }).android?.googleServicesFile,
  ).toBe('/tmp/eas/google.json');
  expect(resolve({ GOOGLE_SERVICES_JSON: undefined }).android?.googleServicesFile).toBe(
    './google-services.json',
  );
});

test('iOS: urgent pushes may break through a Focus, and no export paperwork is asked', () => {
  const ios = resolve().ios;

  expect(ios?.entitlements?.['com.apple.developer.usernotifications.time-sensitive']).toBe(true);
  expect(ios?.config?.usesNonExemptEncryption).toBe(false);
});

test('the photo library question says what the library is used for', () => {
  const picker = plugin(resolve(), 'expo-image-picker');

  expect(String(picker?.photosPermission)).not.toMatch(/does not read/);
  expect(String(picker?.photosPermission)).toMatch(/photo/i);
});

// Imports run in order: crash reports first, so a crash in anything after —
// the app's configuration included — is reported (review С-2, С-7).
test('the entry starts crash reports first, then the push handler, and the router last', () => {
  const entry = readFileSync(join(APP_ROOT, 'index.js'), 'utf8');
  const at = ['./src/crash-reports', './src/boot', 'expo-router/entry'].map((path) =>
    entry.indexOf(`import '${path}';`),
  );

  expect(at.every((position) => position >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(packageJson.main).toBe('index.js');
  expect(packageJson.expo?.install?.exclude).toContain('@sentry/react-native');
});
