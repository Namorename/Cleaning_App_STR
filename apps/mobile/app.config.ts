import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The parts of the app config that come from the build's environment; the
 * rest is app.json, read in as `config`.
 *
 * - Firebase (Android pushes): EAS hands the file over as the file variable
 *   GOOGLE_SERVICES_JSON; a local build reads ./google-services.json, which is
 *   gitignored — the repository is public.
 * - Sentry: organisation and project for the source-map upload, from the
 *   environment. The upload token is never in the config (the plugin would
 *   write it into the app); without it the build uploads nothing rather than
 *   failing.
 * - iOS: urgent pushes are time-sensitive — they may break through a Focus —
 *   and the app uses no encryption of its own, so App Store Connect asks no
 *   export questions.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  return {
    ...base,
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
          disableAutoUpload: process.env.SENTRY_AUTH_TOKEN === undefined,
        },
      ],
    ],
  };
};
