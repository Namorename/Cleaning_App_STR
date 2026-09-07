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
