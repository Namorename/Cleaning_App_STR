import { afterEach, describe, expect, test, vi } from 'vitest';

import { createClient } from '@/lib/supabase/client';

/**
 * The real @supabase/ssr and supabase-js, only the network faked. The retry
 * rests on how these versions talk: a PostgREST request reaches the global
 * fetch as a string address with a string body. An upgrade that changed that
 * would quietly end the retry; these tests would say so.
 */
const staleClock = () =>
  new Response(
    JSON.stringify({ code: 'PGRST303', details: null, hint: null, message: 'JWT issued at future' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
const json = (body: string) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the panel client over the real libraries', () => {
  test('a read refused for the stale clock comes back with its rows', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(staleClock())
      .mockResolvedValueOnce(json('[{"id":"p1"}]'));

    const { data, error } = await createClient().from('problems').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'p1' }]);
    expect(network).toHaveBeenCalledTimes(2);
    const [address] = network.mock.calls[1] ?? [];
    expect(typeof address).toBe('string');
    expect(String(address)).toContain('/rest/v1/problems');
  });

  test('a write refused for the stale clock goes once more, with the same body', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(staleClock())
      .mockResolvedValueOnce(json('null'));

    const { error } = await createClient().rpc('assign_problem', {
      p_id: 'p1',
      p_assignee_id: 'u1',
    });

    expect(error).toBeNull();
    expect(network).toHaveBeenCalledTimes(2);
    const bodies = network.mock.calls.map(([, init]) => init?.body);
    expect(typeof bodies[0]).toBe('string');
    expect(bodies[1]).toBe(bodies[0]);
  });
});
