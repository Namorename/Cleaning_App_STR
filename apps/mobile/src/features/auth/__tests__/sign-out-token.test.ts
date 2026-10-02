import * as SecureStore from 'expo-secure-store';

import { registerThisPhone } from '@/features/push/registration';
import { forgetRegistration, isRegisteredFor, rememberToken } from '@/features/push/token-store';

import { signOut } from '../session';

/**
 * Signing out and the phone's push token, with the real modules and only the
 * server stood in (docs/f11-native-review.md, Т-1 and Т-2): a phone she has
 * left must not keep showing pushes about her flats.
 */

const mockCalls: string[] = [];
const mockServer = {
  online: true,
  holdRegister: false,
  releaseRegister: () => undefined as void,
  signOutError: null as unknown,
  storedSession: null as string | null,
};

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.1.0', extra: { eas: { projectId: 'project-1' } } } },
}));

jest.mock('@/lib/supabase', () => ({
  SESSION_STORAGE_KEY: 'sb-project-auth-token',
  supabase: {
    auth: { signOut: async () => ({ error: mockServer.signOutError }) },
    rpc: (name: string) => {
      const answer = mockServer.online
        ? { error: null }
        : { error: { message: 'TypeError: Network request failed' } };
      mockCalls.push(`${name}:${mockServer.online ? 'answered' : 'failed'}`);
      const result = new Promise<typeof answer>((resolve) => {
        if (name === 'register_push_token' && mockServer.holdRegister) {
          mockServer.releaseRegister = () => resolve(answer);
        } else {
          resolve(answer);
        }
      });
      return Object.assign(result, { abortSignal: () => result });
    },
  },
}));

jest.mock('@/lib/secure-storage', () => ({
  sessionStorage: { getItem: async () => mockServer.storedSession },
}));

async function until(check: () => boolean): Promise<void> {
  while (!check()) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

beforeEach(async () => {
  mockCalls.length = 0;
  Object.assign(mockServer, {
    online: true,
    holdRegister: false,
    signOutError: null,
    storedSession: null,
  });
  await forgetRegistration();
});

test('a registration whose server call is on its way when she signs out is let go of', async () => {
  mockServer.holdRegister = true;
  const registering = registerThisPhone('A');
  await until(() => mockCalls.includes('register_push_token:answered'));

  const signingOut = signOut();
  mockServer.releaseRegister();
  await signingOut;
  await registering;

  expect(mockCalls).toEqual(['register_push_token:answered', 'unregister_push_token:answered']);
  await expect(SecureStore.getItemAsync('push-token')).resolves.toBeNull();
  expect(isRegisteredFor('A')).toBe(false);
});

test('a sign-out that failed offline keeps the token, so the one that succeeds lets go of it', async () => {
  await rememberToken('ExponentPushToken[abc]');

  // Offline, and the access token expired while the app slept: auth-js keeps the session.
  mockServer.online = false;
  mockServer.signOutError = {
    name: 'AuthRetryableFetchError',
    status: 0,
    message: 'Network request failed',
  };
  mockServer.storedSession = '{"access_token":"expired"}';
  await expect(signOut()).rejects.toMatchObject({ name: 'AuthRetryableFetchError' });
  await expect(SecureStore.getItemAsync('push-token')).resolves.toBe('ExponentPushToken[abc]');

  // Back in signal, the app still in front: the second sign-out goes through.
  mockServer.online = true;
  mockServer.signOutError = null;
  mockServer.storedSession = null;
  await expect(signOut()).resolves.toBeUndefined();

  expect(mockCalls).toEqual(['unregister_push_token:failed', 'unregister_push_token:answered']);
  await expect(SecureStore.getItemAsync('push-token')).resolves.toBeNull();
});

test('still in after the server let go of the token: the phone registers for her again', async () => {
  await registerThisPhone('A');
  mockCalls.length = 0;
  mockServer.signOutError = { name: 'AuthApiError', status: 500, message: 'Internal error' };
  mockServer.storedSession = '{"access_token":"valid"}';

  await expect(signOut()).rejects.toMatchObject({ name: 'AuthApiError' });
  await until(() => isRegisteredFor('A'));

  expect(mockCalls).toEqual(['unregister_push_token:answered', 'register_push_token:answered']);
});
