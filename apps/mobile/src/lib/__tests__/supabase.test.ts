import { createClient } from '@supabase/supabase-js';

import { env } from '../env';
import { SESSION_STORAGE_KEY, supabase } from '../supabase';

/**
 * The session's storage key is named so sign-out can look at what is stored.
 * It must be the very key auth-js would choose on its own: a different one
 * would sign out every phone that takes the update, the session sitting under
 * the old name.
 */

type WithStorageKey = { storageKey: string };

test('the named key is the one auth-js chooses by itself, so no phone loses its session', () => {
  const unnamed = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  expect((unnamed as unknown as WithStorageKey).storageKey).toBe(SESSION_STORAGE_KEY);
  expect((supabase as unknown as WithStorageKey).storageKey).toBe(SESSION_STORAGE_KEY);
});

/**
 * PostgREST before 14.18 refuses a fresh token now and then with 401 "JWT
 * issued at future" (its clock lags after an idle spell; the cloud runs 14.5).
 * The phone's client sends such a REST request again, as the panel's does —
 * the wrapper itself is tested with the panel (stale-clock-retry.test.ts).
 */
describe('a REST request PostgREST refused for its stale clock', () => {
  const refusal = (message: string) =>
    new Response(JSON.stringify({ code: 'PGRST303', details: null, hint: null, message }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  const rows = () =>
    new Response(JSON.stringify([{ id: 'p1' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  let fetchSpy: jest.SpyInstance<ReturnType<typeof fetch>, Parameters<typeof fetch>>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('is sent again and the rows of the second answer come back', async () => {
    fetchSpy.mockResolvedValueOnce(refusal('JWT issued at future')).mockResolvedValueOnce(rows());

    const { data, error } = await supabase.from('problems').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'p1' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('is not sent again when the refusal is of another kind', async () => {
    fetchSpy.mockResolvedValueOnce(refusal('JWT expired'));

    const { error } = await supabase.from('problems').select('id');

    expect(error?.message).toBe('JWT expired');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
