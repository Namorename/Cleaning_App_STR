// Expo native modules have no implementation under Jest; the app only needs
// them to behave like a key-value store and a configured environment.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

// A fixed device language, so assertions can quote what the cleaner reads.
// Russian is what the team runs today; the other files are covered by the key
// parity test rather than by rendering every screen three times.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'ru' }],
}));

// Translations, once, for every suite. A component that reads a string
// through useTranslation() renders it in the language above; without this it
// renders an empty label and the failure points at the assertion instead of
// at the missing i18next instance. The locale mock above is hoisted over this
// import, so the language is already fixed when i18n initialises.
import '@/i18n';

import { configure, render } from '@testing-library/react-native';
import { createElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

// The key-value store behind the query cache and the media ledger has no
// native module under Jest; the package ships an in-memory stand-in.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Notifications: jest-expo stubs only the native side, where every promise
// resolves to undefined, so reading a permission would throw. The phone here
// has already allowed them, which keeps every screen that shows the
// permission notice as it looks on a configured phone; a test about another
// state says so with mockResolvedValueOnce.
jest.mock('expo-notifications', () => {
  const allowed = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
  const subscription = () => ({ remove: jest.fn() });
  return {
    AndroidImportance: {
      UNKNOWN: 0,
      UNSPECIFIED: 1,
      NONE: 2,
      MIN: 3,
      LOW: 4,
      DEFAULT: 5,
      HIGH: 6,
      MAX: 7,
    },
    IosAuthorizationStatus: {
      NOT_DETERMINED: 0,
      DENIED: 1,
      AUTHORIZED: 2,
      PROVISIONAL: 3,
      EPHEMERAL: 4,
    },
    DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
    getPermissionsAsync: jest.fn(async () => allowed),
    requestPermissionsAsync: jest.fn(async () => allowed),
    getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[test]' })),
    setNotificationChannelAsync: jest.fn(async () => null),
    getNotificationChannelAsync: jest.fn(async () => null),
    setNotificationHandler: jest.fn(),
    getLastNotificationResponse: jest.fn(() => null),
    clearLastNotificationResponse: jest.fn(),
    dismissAllNotificationsAsync: jest.fn(async () => undefined),
    useLastNotificationResponse: jest.fn(() => null),
    addNotificationReceivedListener: jest.fn(subscription),
    addNotificationResponseReceivedListener: jest.fn(subscription),
    addPushTokenListener: jest.fn(subscription),
  };
});

// A real phone, not a simulator: pushes are only registered on one.
jest.mock('expo-device', () => ({ __esModule: true, isDevice: true }));

// The package's own stand-in: connected, and a listener that is never called
// unless a test calls it.
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// Crash reports go nowhere under test.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: <T>(component: T) => component,
  captureException: jest.fn(),
  setUser: jest.fn(),
}));

// `waitFor` and `findBy*` give up after one second by default. An answer
// that is already resolved can still take longer than that to reach the
// screen when every core is busy, and a wait that fails on a busy machine
// only says the machine was busy. Kept below the per-test timeout in
// jest.config.js, so a wait that never succeeds names what it waited for.
configure({ asyncUtilTimeout: 5_000 });

/** A first render for the whole file, far above what it ever takes. */
const WARM_UP_TIMEOUT_MS = 60_000;

// Every test file starts with an empty module registry, and the first render
// in it pays for loading React Native's components and warming the renderer.
// Measured on step-screen: its first test takes 0.7–1.2 s alone, 3–4.7 s with
// four workers and over 5 s with the cores shared ("Exceeded timeout of 5000
// ms"), while every later test in the file takes 10–30 ms. Drawing once here
// moves that cost out of every test's budget into a hook with its own.
beforeAll(async () => {
  const { unmount } = await render(
    createElement(
      ScrollView,
      null,
      createElement(View, null, createElement(Text, null, 'warm-up')),
      createElement(Pressable, { accessibilityRole: 'button' }),
      createElement(ActivityIndicator),
    ),
  );
  await unmount();
}, WARM_UP_TIMEOUT_MS);
