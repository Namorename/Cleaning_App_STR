import { forgetThisPhone } from '@/features/push/api';

import { signOut } from '../session';

/**
 * Signing out lets go of the phone's push token first — afterwards the call
 * would run with no one signed in, and the server would refuse it — and then
 * leaves. Without signal the session is gone all the same (auth-js removes it
 * before it reports the network), so that is not a failure to show her.
 */

const mockSignOut = jest.fn();
const calls: string[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: () => mockSignOut() } },
}));

jest.mock('@/features/push/api', () => ({
  forgetThisPhone: jest.fn(),
}));

const mockForget = jest.mocked(forgetThisPhone);

beforeEach(() => {
  calls.length = 0;
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

test('no signal: she is signed out, and nothing is reported as failed', async () => {
  mockSignOut.mockResolvedValue({
    error: { name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' },
  });

  await expect(signOut()).resolves.toBeUndefined();
});

test('a refusal the server sent still reaches the screen', async () => {
  const refusal = { name: 'AuthApiError', status: 500, message: 'Internal error' };
  mockSignOut.mockResolvedValue({ error: refusal });

  await expect(signOut()).rejects.toBe(refusal);
});
