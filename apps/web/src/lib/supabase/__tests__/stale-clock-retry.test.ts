import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  STALE_CLOCK_RETRY_DELAYS_MS,
  withStaleClockRetry,
} from '@/lib/supabase/stale-clock-retry';

const REST = 'https://project.supabase.co/rest/v1/problems?select=id';
const RPC = 'https://project.supabase.co/rest/v1/rpc/assign_problem';
const AUTH = 'https://project.supabase.co/auth/v1/token?grant_type=refresh_token';

/** A PostgREST refusal, the body as PostgREST 14 sends it. */
const refusal = (message: string) =>
  new Response(JSON.stringify({ code: 'PGRST303', details: null, hint: null, message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
const staleClock = () => refusal('JWT issued at future');
const ok = () => new Response('[]', { status: 200 });

afterEach(() => {
  vi.useRealTimers();
});

describe('withStaleClockRetry', () => {
  test('sends a REST request again after PostgREST refused a fresh token for its stale clock', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(staleClock())
      .mockResolvedValueOnce(ok());
    const init = { method: 'POST', body: '{"p_problem_id":"1"}' };

    const response = await withStaleClockRetry(fetchImpl, [0])(RPC, init);

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith(RPC, init);
  });

  test('waits before sending again', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(staleClock())
      .mockResolvedValueOnce(ok());

    const pending = withStaleClockRetry(fetchImpl, [300])(REST);
    await vi.advanceTimersByTimeAsync(299);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect((await pending).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('gives up after the last delay and hands the refusal over, still readable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => staleClock());

    const response = await withStaleClockRetry(fetchImpl, [0, 0])(REST);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ message: 'JWT issued at future' });
  });

  test('returns any other refusal at once, its body unread', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(refusal('JWT expired'));

    const response = await withStaleClockRetry(fetchImpl, [0])(REST);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({ message: 'JWT expired' });
  });

  test('leaves requests that are not REST alone', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(staleClock());

    const response = await withStaleClockRetry(fetchImpl, [0])(AUTH, { method: 'POST' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
  });

  test('reads the address off a Request and a URL as well as a string', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => staleClock());

    await withStaleClockRetry(fetchImpl, [0])(new URL(REST));
    await withStaleClockRetry(fetchImpl, [0])(new Request(REST));

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  test('does not send again a request whose body could not be read a second time', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => staleClock());

    await withStaleClockRetry(fetchImpl, [0])(new Request(RPC, { method: 'POST', body: '{}' }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('stops waiting when the request is aborted, and sends nothing more', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(staleClock());

    const pending = withStaleClockRetry(fetchImpl, [1_000])(REST, { signal: controller.signal });
    const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();

    await settled;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('returns a refusal whose body is not JSON at once, its body still readable', async () => {
    const page = new Response('<html>401 Authorization Required</html>', { status: 401 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(page);

    const response = await withStaleClockRetry(fetchImpl, [0])(REST);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toContain('Authorization Required');
  });

  test('stops at a refusal of another kind on the resend and returns that one', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(staleClock())
      .mockResolvedValueOnce(refusal('JWT expired'));

    const response = await withStaleClockRetry(fetchImpl, [0, 0])(REST);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({ message: 'JWT expired' });
  });

  test('does not wait at all when the request was cancelled before the pause', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(staleClock());

    await expect(
      withStaleClockRetry(fetchImpl, [1_000])(REST, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(vi.getTimerCount()).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('leaves no abort listener behind once the pause is over', async () => {
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(staleClock())
      .mockResolvedValueOnce(ok());

    await withStaleClockRetry(fetchImpl, [0])(REST, { signal: controller.signal });

    expect(added).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0]?.[1]);
  });

  test('passes successes and network failures through untouched', async () => {
    const success = ok();
    const offline = new TypeError('Failed to fetch');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(success)
      .mockRejectedValueOnce(offline);
    const wrapped = withStaleClockRetry(fetchImpl, [0]);

    expect(await wrapped(REST)).toBe(success);
    await expect(wrapped(REST)).rejects.toBe(offline);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('keeps the whole wait for a manager short', () => {
    const total = STALE_CLOCK_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);

    expect(STALE_CLOCK_RETRY_DELAYS_MS.length).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(1_500);
  });
});
