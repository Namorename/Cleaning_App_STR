import { clearThisPhone, releaseThisPhone } from '@/features/push/api';
import { registerThisPhone } from '@/features/push/registration';
import { registrant, unmarkRegistered } from '@/features/push/token-store';
import { sessionStorage } from '@/lib/secure-storage';

import { signOut } from '../session';

/**
 * Signing out lets go of the phone's push token first — afterwards the call
 * would run with no one signed in, and the server would refuse it — and then
 * leaves. Without signal auth-js usually removes the session all the same and
 * only reports the network: then she is out, and nothing failed. But with an
 * access token that expired while the app slept, it cannot refresh, keeps the
 * session and returns the same network error — then she is still in, and the
 * screen must say so.
 *
 * The phone forgets its token only once she is out (docs/f11-native-review.md,
 * Т-2): a sign-out that failed keeps the record for the next one to let go of,
 * and one that failed after the server let go registers the phone again.
 */

const mockSignOut = jest.fn();
const calls: string[] = [];

jest.mock('@/lib/supabase', () => ({
  SESSION_STORAGE_KEY: 'sb-project-auth-token',
  supabase: { auth: { signOut: () => mockSignOut() } },
}));

jest.mock('@/lib/secure-storage', () => ({
  sessionStorage: { getItem: jest.fn(async () => null) },
}));

jest.mock('@/features/push/api', () => ({
  releaseThisPhone: jest.fn(),
  clearThisPhone: jest.fn(),
}));

jest.mock('@/features/push/registration', () => ({
  registerThisPhone: jest.fn(async () => true),
}));

jest.mock('@/features/push/token-store', () => ({
  registrant: jest.fn(() => 'me'),
  unmarkRegistered: jest.fn(),
}));

const mockRelease = jest.mocked(releaseThisPhone);
const mockClear = jest.mocked(clearThisPhone);
const mockRegister = jest.mocked(registerThisPhone);
const storedSession = jest.mocked(sessionStorage.getItem);
const noSignal = {
  name: 'AuthRetryableFetchError',
  status: 0,
  message: 'Network request failed',
};

beforeEach(() => {
  calls.length = 0;
  jest.mocked(registrant).mockReturnValue('me');
  jest.mocked(unmarkRegistered).mockClear();
  mockRegister.mockClear();
  storedSession.mockReset().mockResolvedValue(null);
  mockRelease.mockReset().mockImplementation(async () => {
    calls.push('release');
    return 'released';
  });
  mockClear.mockReset().mockImplementation(async () => {
    calls.push('clear');
  });
  mockSignOut.mockReset().mockImplementation(async () => {
    calls.push('signOut');
    return { error: null };
  });
});

test('lets go of the phone before signing out, and clears it once she is out', async () => {
  await signOut();

  expect(calls).toEqual(['release', 'signOut', 'clear']);
});

test('no signal, and the session is gone: she is signed out, nothing failed, the phone is cleared', async () => {
  mockSignOut.mockResolvedValue({ error: noSignal });

  await expect(signOut()).resolves.toBeUndefined();

  expect(storedSession).toHaveBeenCalledWith('sb-project-auth-token');
  expect(mockClear).toHaveBeenCalledTimes(1);
});

test('no signal, and the session is still stored: she is still in, is told, and the phone keeps its token', async () => {
  mockRelease.mockResolvedValue('unconfirmed');
  mockSignOut.mockResolvedValue({ error: noSignal });
  storedSession.mockResolvedValue('{"access_token":"expired"}');

  await expect(signOut()).rejects.toBe(noSignal);

  expect(mockClear).not.toHaveBeenCalled();
  expect(mockRegister).not.toHaveBeenCalled();
});

test('still in after the server let go of the token: the phone is registered for her again', async () => {
  const refusal = { name: 'AuthApiError', status: 500, message: 'Internal error' };
  mockSignOut.mockResolvedValue({ error: refusal });
  storedSession.mockResolvedValue('{"access_token":"valid"}');

  await expect(signOut()).rejects.toBe(refusal);

  expect(mockClear).not.toHaveBeenCalled();
  expect(unmarkRegistered).toHaveBeenCalledTimes(1);
  expect(mockRegister).toHaveBeenCalledWith('me');
});

test('a refusal the server sent still reaches the screen', async () => {
  const refusal = { name: 'AuthApiError', status: 500, message: 'Internal error' };
  mockSignOut.mockResolvedValue({ error: refusal });

  await expect(signOut()).rejects.toBe(refusal);
});
