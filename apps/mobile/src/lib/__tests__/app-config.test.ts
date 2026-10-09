import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { getResolvedLocalesAsync } from '@expo/config-plugins/build/utils/locales';
import { SUPPORTED_LANGUAGES, THEME_COLORS } from '@str-ops/shared';
import type { ExpoConfig } from 'expo/config';

import { PUSH_CHANNELS } from '@/features/push/channels';

import enLocale from '../../../../../packages/shared/src/i18n/locales/en.json';
import appJson from '../../../app.json';
import easJson from '../../../eas.json';
import packageJson from '../../../package.json';
import resolveConfig, { checkBuildEnv } from '../../../app.config';

/**
 * The native build 1.2.0 as the config describes it. A mistake here is found
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

/** The strings one platform's build writes per language, resolved as Expo's locales plugin does. */
async function platformLocales(
  config: ExpoConfig,
  platform: 'ios' | 'android',
): Promise<Record<string, Record<string, unknown>>> {
  const { localesMap } = await getResolvedLocalesAsync(APP_ROOT, config.locales ?? {}, platform);
  return localesMap;
}

test('the build is 1.2.0, and OTA updates follow the version', () => {
  const config = resolve();

  expect(config.version).toBe('1.2.0');
  expect(config.runtimeVersion).toEqual({ policy: 'appVersion' });
});

test('notifications: the default channel is one the app makes, and the icon exists', () => {
  const notifications = plugin(resolve(), 'expo-notifications');

  expect(PUSH_CHANNELS).toContain(notifications?.defaultChannel);
  expect(existsSync(join(APP_ROOT, String(notifications?.icon)))).toBe(true);
});

/** Width, height and whether the image carries an alpha channel, from the PNG header. */
function pngHeader(relative: string): { width: number; height: number; hasAlpha: boolean } {
  const bytes = readFileSync(join(APP_ROOT, relative.replace(/^\.\//, '')));
  // IHDR follows the 8-byte signature and its own length and type: width, height, depth, colour type.
  const colourType = bytes[25];
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasAlpha: colourType === 4 || colourType === 6,
  };
}

type Rgba = [number, number, number, number];

/** Decodes an 8-bit RGB or RGBA PNG into a pixel reader. Enough for our own icons. */
function decodePng(relative: string): { width: number; height: number; at(x: number, y: number): Rgba } {
  const bytes = readFileSync(join(APP_ROOT, relative.replace(/^\.\//, '')));
  const { width, height } = pngHeader(relative);
  const channels = bytes[25] === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString('latin1', at + 4, at + 8) === 'IDAT') {
      idat.push(bytes.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows: Uint8Array[] = [];
  let previous = new Uint8Array(stride);
  for (let line = 0; line < height; line += 1) {
    const filter = raw[line * (stride + 1)];
    const data = raw.subarray(line * (stride + 1) + 1, (line + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      const guess = left + up - upLeft;
      const paeth =
        Math.abs(guess - left) <= Math.abs(guess - up) && Math.abs(guess - left) <= Math.abs(guess - upLeft)
          ? left
          : Math.abs(guess - up) <= Math.abs(guess - upLeft)
            ? up
            : upLeft;
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter];
      row[i] = (data[i] + predictor) & 0xff;
    }
    rows.push(row);
    previous = row;
  }
  return {
    width,
    height,
    at(x, y) {
      const row = rows[y];
      const at = x * channels;
      return [row[at], row[at + 1], row[at + 2], channels === 4 ? row[at + 3] : 255];
    },
  };
}

function hex(colour: string): Rgba {
  const value = Number.parseInt(colour.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, 255];
}

// The redesign's native part (docs/design/decisions.md, 8–10): the name, the icon
// and the splash are resources in the binary — an update over the air cannot change them.
test('the name under the icon is «woom», the same in every language', async () => {
  const config = resolve();

  expect(config.name).toBe('woom');
  for (const strings of Object.values(await platformLocales(config, 'ios'))) {
    expect(strings).not.toHaveProperty('CFBundleDisplayName');
  }
});

test('the app icon is the «Абрикос» mark on the theme background, 1024 px and opaque', () => {
  const config = resolve();

  expect(config.icon).toBe('./assets/images/icon.png');
  expect(pngHeader('assets/images/icon.png')).toEqual({ width: 1024, height: 1024, hasAlpha: false });
  expect(config.android?.adaptiveIcon?.backgroundColor).toBe(THEME_COLORS.light.bg);
  for (const layer of ['foregroundImage', 'backgroundImage', 'monochromeImage'] as const) {
    const path = String(config.android?.adaptiveIcon?.[layer]);
    expect(pngHeader(path)).toMatchObject({ width: 1024, height: 1024 });
  }
  // The pixels, not only the names: the background image overrides backgroundColor on the launcher.
  expect(decodePng('assets/images/icon.png').at(0, 0)).toEqual(hex(THEME_COLORS.light.bg));
  expect(
    decodePng(String(config.android?.adaptiveIcon?.backgroundImage)).at(512, 512),
  ).toEqual(hex(THEME_COLORS.light.bg));
});

test('iOS: the icon comes light, dark and tinted; the light one has no alpha (App Store)', () => {
  const icon = resolve().ios?.icon as unknown as { light: string; dark: string; tinted: string };

  expect(Object.keys(icon).sort()).toEqual(['dark', 'light', 'tinted']);
  expect(pngHeader(icon.light)).toEqual({ width: 1024, height: 1024, hasAlpha: false });
  expect(pngHeader(icon.dark)).toMatchObject({ width: 1024, height: 1024 });
  // Expo flattens the tinted icon onto white (withIosIcons: removeTransparency for every
  // appearance but dark), so a white mark on transparency would ship as a blank white tile.
  // It must already be opaque: a light mark on a dark ground.
  expect(pngHeader(icon.tinted)).toEqual({ width: 1024, height: 1024, hasAlpha: false });
  const [red, green, blue] = decodePng(icon.tinted).at(0, 0);
  expect(Math.max(red, green, blue)).toBeLessThan(40);
  const [markRed] = decodePng(icon.tinted).at(512, 400);
  expect(markRed).toBeGreaterThan(200);
});

test('the splash is the theme background with the mark, light and dark (decision 9)', () => {
  const splash = plugin(resolve(), 'expo-splash-screen') as {
    backgroundColor: string;
    image: string;
    dark: { backgroundColor: string; image: string };
  };

  expect(splash.backgroundColor).toBe(THEME_COLORS.light.bg);
  expect(splash.dark.backgroundColor).toBe(THEME_COLORS.dark.bg);
  for (const image of [splash.image, splash.dark.image]) {
    expect(pngHeader(image)).toEqual({ width: 1024, height: 1024, hasAlpha: true });
  }
});

test('notifications: the icon is a white silhouette and the accent is the primary colour', () => {
  const notifications = plugin(resolve(), 'expo-notifications');

  expect(notifications?.color).toBe(THEME_COLORS.light.primary);
  expect(pngHeader(String(notifications?.icon))).toEqual({ width: 96, height: 96, hasAlpha: true });
  // Android draws only the alpha of a notification icon: every visible pixel is white.
  const image = decodePng(String(notifications?.icon));
  let visible = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const [red, green, blue, alpha] = image.at(x, y);
      if (alpha > 0) {
        visible += 1;
        expect([red, green, blue]).toEqual([255, 255, 255]);
      }
    }
  }
  expect(visible).toBeGreaterThan(0);
});

// expo-camera ships as a ready library that pulls the ML Kit barcode scanner in
// whatever its flags say (ROADMAP, «Android: ML Kit»); building it from source
// lets the disabled scanner stay out. Checked for real only by an EAS build.
test('Android: expo-camera is built from source, so the barcode scanner stays out', () => {
  const { expo } = packageJson as {
    expo?: { autolinking?: { android?: { buildFromSource?: string[] } } };
  };

  expect(expo?.autolinking?.android?.buildFromSource).toContain('expo-camera');
});

test('the field builds: an APK and a TestFlight build on their own channel', () => {
  const build = easJson.build as Record<
    string,
    { channel?: string; distribution?: string; android?: { buildType?: string } }
  >;

  expect(build.field).toMatchObject({
    channel: 'field',
    distribution: 'internal',
    environment: 'production',
  });
  expect(build.field.android?.buildType).toBe('apk');
  // A store build without autoIncrement fails only at upload, on a duplicate build number.
  expect(build['field-ios']).toMatchObject({
    channel: 'field',
    distribution: 'store',
    environment: 'production',
    autoIncrement: true,
  });
  expect((easJson.submit as Record<string, unknown>)['field-ios']).toBeDefined();
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

// An app linked against the iOS 27 SDK (Xcode 27) must use the UIScene life
// cycle or it stops at launch (Apple TN3187), and SDK 57 wires no scene
// delegate. EAS builds SDK 57 on Xcode 26.6 today; the image is named so that
// a change of EAS's default cannot move the build to Xcode 27 unnoticed. A
// launch crash there is not something an update over the air can fix.
const XCODE_26_IMAGE = 'macos-tahoe-26.5-xcode-26.6';

test('iOS: every store build is made on the Xcode 26 image', () => {
  const build = easJson.build as Record<string, { ios?: { image?: string } }>;

  expect(build.testflight.ios?.image).toBe(XCODE_26_IMAGE);
  expect(build['field-ios'].ios?.image).toBe(XCODE_26_IMAGE);
  expect(build.production.ios?.image).toBe(XCODE_26_IMAGE);
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

test('iOS: every permission question is written in each of her languages', async () => {
  const config = resolve();
  const picker = plugin(config, 'expo-image-picker');
  const english: Record<string, unknown> = {
    NSCameraUsageDescription: picker?.cameraPermission,
    NSMicrophoneUsageDescription: picker?.microphonePermission,
    NSPhotoLibraryUsageDescription: picker?.photosPermission,
  };
  const ios = await platformLocales(config, 'ios');

  for (const language of SUPPORTED_LANGUAGES.filter((one) => one !== 'en')) {
    for (const [key, value] of Object.entries(english)) {
      expect(typeof ios[language]?.[key]).toBe('string');
      expect(ios[language]?.[key]).not.toBe(value);
    }
  }
});

// Android's release lint refuses a string translated with no default-language
// value (ExtraTranslation). Info.plist keys at the top of a locale land in
// values-b+ru and values-b+cs as well, and the first 1.1.0 build failed on
// exactly that (2026-10-02, :app:lintVitalRelease).
test('Android: none of the iOS permission reasons reach the Android string resources', async () => {
  const android = await platformLocales(resolve(), 'android');

  for (const strings of Object.values(android)) {
    expect(Object.keys(strings).filter((key) => key.startsWith('NS'))).toEqual([]);
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

// Video steps are recorded with the app's own camera, not the system's (owner's
// word 2026-09-30): length, size and bitrate are the app's to set, and it
// writes no location into the file. Native, so it has to be in this build.
//
// The barcode switch keeps ZXing out of the iOS build. On Android the prebuilt
// expo-camera library would bring ML Kit whatever the switch says; since 1.2.0
// the module is built from source (the buildFromSource test above), which lets
// the switch keep the scanner out there too — checked for real by a build alone.
test('the in-app camera is in the build, records sound, and its barcode scanner is switched off', () => {
  const camera = plugin(resolve(), 'expo-camera');

  expect(packageJson.dependencies['expo-camera']).toBeDefined();
  expect(camera?.recordAudioAndroid).toBe(true);
  expect(camera?.barcodeScannerEnabled).toBe(false);
});

// The recording is watched on the phone before it is sent (owner's word
// 2026-10-01). A player is native, so it has to be in this build. It plays in
// the screen only: its config plugin adds nothing but background audio,
// picture in picture and a playback service, so it is left out of the list —
// given even `false` it writes an empty UIBackgroundModes into Info.plist.
test('the video player is in the build, for the screen only', () => {
  const names = ((resolve().plugins ?? []) as Plugin[]).map((entry) =>
    Array.isArray(entry) ? entry[0] : entry,
  );

  expect(packageJson.dependencies['expo-video']).toBeDefined();
  expect(names).not.toContain('expo-video');
});

// The app never asks for Face ID: expo-secure-store would otherwise add its
// generic "access your Face ID biometric data" reason to the first iOS build,
// a reason with nothing behind it for App Review to read.
test('iOS: no Face ID reason — the app does not use biometrics', () => {
  const secureStore = plugin(resolve(), 'expo-secure-store');

  expect(secureStore?.faceIDPermission).toBe(false);
});

/** Every source file of the app, tests aside. */
function appSources(dir = join(APP_ROOT, 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : appSources(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// Without that reason iOS throws the moment code asks for biometrics, and the
// reason can only come back with a native build — so an update over the air
// must not start asking. Biometrics need a Face ID reason and a new build first.
test('no code asks for biometrics, which this build has no Face ID reason for', () => {
  const asking = appSources().filter((path) =>
    /requireAuthentication|expo-local-authentication/.test(readFileSync(path, 'utf8')),
  );

  expect(asking).toEqual([]);
});

// Both plugins write the same two iOS reasons; whichever runs last wins, so
// they must say the same thing.
test('iOS: the camera and the picker give the same reasons for the camera and the microphone', () => {
  const config = resolve();
  const camera = plugin(config, 'expo-camera');
  const picker = plugin(config, 'expo-image-picker');

  expect(camera?.cameraPermission).toBe(picker?.cameraPermission);
  expect(camera?.microphonePermission).toBe(picker?.microphonePermission);
});

// A technician's work is not a cleaning (owner's word 2026-09-30): the reasons
// iOS shows speak of the work, in every language.
test('iOS: the permission reasons speak of the work, not of cleaning', async () => {
  const config = resolve();
  const ios = await platformLocales(config, 'ios');
  const reasons = [
    ...Object.values(plugin(config, 'expo-image-picker') ?? {}),
    ...Object.values(ios).flatMap((strings) => Object.values(strings)),
  ].map(String);

  expect(reasons.length).toBeGreaterThanOrEqual(9);
  for (const reason of reasons) {
    expect(reason).not.toMatch(/clean|убор|úklid/i);
  }
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
