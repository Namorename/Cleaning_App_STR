import { forgetThisPhone } from '@/features/push/api';
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
  forgetThisPhone: jest.fn(),
}));

const mockForget = jest.mocked(forgetThisPhone);
const storedSession = jest.mocked(sessionStorage.getItem);
const noSignal = {
  name: 'AuthRetryableFetchError',
  status: 0,
  message: 'Network request failed',
};

beforeEach(() => {
  calls.length = 0;
  storedSession.mockReset().mockResolvedValue(null);
  mockForget.mockReset().mockImplementation(async () => {
    calls.push('forget');
  });
  mockSignOut.mockReset().mockImplementation(async () => {
    calls.push('signOut');
    return { error: null };
  });
});

test('lets go of the phone before signing out', async () => {
  await signOut();

  expect(calls).toEqual(['forget', 'signOut']);
});

test('no signal, and the session is gone: she is signed out, and nothing failed', async () => {
  mockSignOut.mockResolvedValue({ error: noSignal });

  await expect(signOut()).resolves.toBeUndefined();

  expect(storedSession).toHaveBeenCalledWith('sb-project-auth-token');
});

test('no signal, and the session is still stored: she is still in, and is told', async () => {
  mockSignOut.mockResolvedValue({ error: noSignal });
  storedSession.mockResolvedValue('{"access_token":"expired"}');

  await expect(signOut()).rejects.toBe(noSignal);
});

test('a refusal the server sent still reaches the screen', async () => {
  const refusal = { name: 'AuthApiError', status: 500, message: 'Internal error' };
  mockSignOut.mockResolvedValue({ error: refusal });

  await expect(signOut()).rejects.toBe(refusal);
});
