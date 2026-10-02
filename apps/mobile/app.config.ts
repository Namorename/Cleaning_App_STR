import type { ConfigContext, ExpoConfig } from 'expo/config';

import cs from '../../packages/shared/src/i18n/locales/cs.json';
import ru from '../../packages/shared/src/i18n/locales/ru.json';

/**
 * The parts of the app config that come from the build's environment; the
 * rest is app.json, read in as `config`.
 *
 * - Firebase (Android pushes): EAS hands the file over as the file variable
 *   GOOGLE_SERVICES_JSON; a local build reads ./google-services.json, which is
 *   gitignored — the repository is public.
 * - Sentry: organisation and project for the source-map upload, from the
 *   environment. The upload token is never in the config (the plugin would
 *   write it into the app). The upload runs only when token, organisation and
 *   project are all there.
 * - iOS: urgent pushes are time-sensitive — they may break through a Focus —
 *   and the app uses no encryption of its own, so App Store Connect asks no
 *   export questions.
 */

type BuildEnv = Record<string, string | undefined>;

const SENTRY_UPLOAD = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'] as const;

function isSet(env: BuildEnv, name: string): boolean {
  return (env[name] ?? '') !== '';
}

/**
 * What an EAS build is checked for before it starts, rather than found out
 * forty minutes later (docs/f11-native-review.md, С-2, С-3). An error stops
 * the build: without the cloud's address the app crashes at start, and half a
 * source-map upload fails the iOS build at its very end. A warning does not:
 * a build without Sentry works, it only reports nothing.
 */
export function checkBuildEnv(env: BuildEnv): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) {
    if (!isSet(env, name)) {
      errors.push(`${name} is not set in this EAS environment: the app would crash at start.`);
    }
  }
  const upload = SENTRY_UPLOAD.filter((name) => isSet(env, name));
  if (upload.length > 0 && upload.length < SENTRY_UPLOAD.length) {
    const missing = SENTRY_UPLOAD.filter((name) => !isSet(env, name));
    errors.push(
      `${missing.join(', ')} not set while ${upload.join(', ')} is: the source-map upload would fail.`,
    );
  }
  if (upload.length === 0) {
    warnings.push("No Sentry upload settings: this build's stack traces will not be readable.");
  }
  if (!isSet(env, 'EXPO_PUBLIC_SENTRY_DSN')) {
    warnings.push('EXPO_PUBLIC_SENTRY_DSN is not set: this build reports no crashes.');
  }
  return { errors, warnings };
}

/**
 * The reasons iOS shows when the app asks for the camera, the microphone and
 * the photos, in each of her languages (docs/f11-native-review.md, С-4). The
 * English ones are app.json's, set on expo-image-picker and, word for word,
 * on expo-camera; the translations live with every other text of the app, in
 * the shared locales. They speak of the work, not of cleaning: a technician
 * reads them too.
 *
 * They sit under `ios`, which Expo writes to iOS alone. A key at the top of a
 * locale goes to Android as well, into values-b+ru and values-b+cs with no
 * default-language value, and Android's release lint refuses the build
 * (ExtraTranslation) — the first 1.1.0 build failed on exactly that.
 */
function permissionTexts(texts: { camera: string; microphone: string; photos: string }) {
  return {
    ios: {
      NSCameraUsageDescription: texts.camera,
      NSMicrophoneUsageDescription: texts.microphone,
      NSPhotoLibraryUsageDescription: texts.photos,
    },
  };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  if (process.env.EAS_BUILD === 'true') {
    const { errors, warnings } = checkBuildEnv(process.env);
    // The build log is where these are read; a local run is not held to them.
    for (const warning of warnings) {
      console.warn(warning);
    }
    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }
  }

  const base = config as ExpoConfig;
  return {
    ...base,
    locales: {
      ...base.locales,
      ru: permissionTexts(ru.iosPermissions),
      cs: permissionTexts(cs.iosPermissions),
    },
    ios: {
      ...base.ios,
      config: { ...base.ios?.config, usesNonExemptEncryption: false },
      entitlements: {
        ...base.ios?.entitlements,
        'com.apple.developer.usernotifications.time-sensitive': true,
      },
    },
    android: {
      ...base.android,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    },
    plugins: [
      ...(base.plugins ?? []),
      [
        '@sentry/react-native/expo',
        {
          url: 'https://sentry.io/',
          organization: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          disableAutoUpload: !SENTRY_UPLOAD.every((name) => isSet(process.env, name)),
        },
      ],
    ],
  };
};
