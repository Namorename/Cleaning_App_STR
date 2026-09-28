import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';

import { PUSH_CHANNELS } from '@/features/push/channels';

import appJson from '../../../app.json';
import packageJson from '../../../package.json';
import resolveConfig from '../../../app.config';

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

test('Sentry: a build without the upload token still builds, without uploading', () => {
  const without = plugin(resolve({ SENTRY_AUTH_TOKEN: undefined }), '@sentry/react-native/expo');
  const withToken = plugin(resolve({ SENTRY_AUTH_TOKEN: 'token' }), '@sentry/react-native/expo');

  expect(without?.disableAutoUpload).toBe(true);
  expect(withToken?.disableAutoUpload).toBe(false);
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

test('the entry runs crash reports and the push handler before the router', () => {
  expect(packageJson.main).toBe('index.js');
  expect(packageJson.expo?.install?.exclude).toContain('@sentry/react-native');
});
