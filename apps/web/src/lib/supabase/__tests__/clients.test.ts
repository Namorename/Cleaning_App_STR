import { afterEach, describe, expect, test, vi } from 'vitest';

import { createClient } from '@/lib/supabase/client';

const ssr = vi.hoisted(() => ({
  createBrowserClient: vi.fn<(...args: unknown[]) => object>(() => ({})),
}));
vi.mock('@supabase/ssr', () => ssr);

const REST = 'https://project.supabase.co/rest/v1/problems?select=id';
const staleClock = () =>
  new Response(
    JSON.stringify({ code: 'PGRST303', details: null, hint: null, message: 'JWT issued at future' }),
    { status: 401 },
  );
const ok = () => new Response('[]', { status: 200 });

interface ClientOptions {
  global?: { fetch?: typeof fetch };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Every read and write of the panel's sections goes through this client
// (useSupabase). The server's client and the proxy's talk to Auth alone;
// client-factories.test.ts holds them to that.
describe('the browser client', () => {
  test('is handed the fetch that sends a REST request refused for the stale clock again', async () => {
    vi.useFakeTimers();
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(staleClock())
      .mockResolvedValueOnce(ok());

    createClient();
    const options = ssr.createBrowserClient.mock.calls.at(-1)?.[2] as ClientOptions | undefined;
    const clientFetch = options?.global?.fetch;
    expect(clientFetch).toBeTypeOf('function');
    const pending = clientFetch!(REST);
    await vi.runAllTimersAsync();

    expect((await pending).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(2);
  });
});
