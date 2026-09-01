import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Storage adapter for the Supabase auth session.
 *
 * The session goes to the Keychain / Keystore rather than AsyncStorage: it
 * carries a refresh token, and anything in AsyncStorage is readable from a
 * rooted device or a device backup.
 *
 * SecureStore rejects values over 2048 bytes on Android, and a session with a
 * JWT of any size comfortably exceeds that, so values are split across
 * numbered entries. The chunk count lives under its own key — its absence is
 * what "nothing stored" means.
 */
const CHUNK_SIZE = 1800;
const COUNT_SUFFIX = '__n';

interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function chunkKey(key: string, index: number): string {
  return `${key}__${index}`;
}

async function readChunkCount(key: string): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(key + COUNT_SUFFIX);
  if (raw === null) {
    return null;
  }

  const count = Number.parseInt(raw, 10);
  return Number.isInteger(count) && count > 0 ? count : null;
}

async function clearChunks(key: string, count: number): Promise<void> {
  const removals = Array.from({ length: count }, (_, index) =>
    SecureStore.deleteItemAsync(chunkKey(key, index)),
  );
  await Promise.all(removals);
  await SecureStore.deleteItemAsync(key + COUNT_SUFFIX);
}

const secureStore: KeyValueStore = {
  async getItem(key) {
    const count = await readChunkCount(key);
    if (count === null) {
      return null;
    }

    const parts = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        SecureStore.getItemAsync(chunkKey(key, index)),
      ),
    );

    // A partially written session is unusable: treat it as absent so the user
    // is asked to sign in again instead of hitting an opaque token error.
    if (parts.some((part) => part === null)) {
      await clearChunks(key, count);
      return null;
    }

    return parts.join('');
  },

  async setItem(key, value) {
    const previous = await readChunkCount(key);
    if (previous !== null) {
      await clearChunks(key, previous);
    }

    const chunks: string[] = [];
    for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
      chunks.push(value.slice(offset, offset + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)),
    );
    await SecureStore.setItemAsync(key + COUNT_SUFFIX, String(chunks.length));
  },

  async removeItem(key) {
    const count = await readChunkCount(key);
    if (count !== null) {
      await clearChunks(key, count);
    }
  },
};

// SecureStore has no web implementation. The browser build is a development
// convenience, not a shipped surface, so localStorage is enough there.
const webStore: KeyValueStore = {
  async getItem(key) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async setItem(key, value) {
    globalThis.localStorage?.setItem(key, value);
  },
  async removeItem(key) {
    globalThis.localStorage?.removeItem(key);
  },
};

export const sessionStorage: KeyValueStore = Platform.OS === 'web' ? webStore : secureStore;
