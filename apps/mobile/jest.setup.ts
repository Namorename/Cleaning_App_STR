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
