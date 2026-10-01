import { afterEach, describe, expect, test, vi } from 'vitest';

import { createClient as createBrowserSide } from '@/lib/supabase/client';
import { createClient as createServerSide } from '@/lib/supabase/server';

const ssr = vi.hoisted(() => ({
  createBrowserClient: vi.fn<(...args: unknown[]) => object>(() => ({})),
  createServerClient: vi.fn<(...args: unknown[]) => object>(() => ({})),
}));
vi.mock('@supabase/ssr', () => ssr);
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

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

/** The fetch the last client was handed — what every one of its requests goes through. */
const fetchOf = (factory: typeof ssr.createBrowserClient): typeof fetch | undefined =>
  (factory.mock.calls.at(-1)?.[2] as ClientOptions | undefined)?.global?.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Every section of the panel reads through one of these two: the browser's
// client (useSupabase) and the server's (layout, settings, sign-in).
describe.each([
  [
    'the browser client',
    async () => {
      createBrowserSide();
      return fetchOf(ssr.createBrowserClient);
    },
  ],
  [
    'the server client',
    async () => {
      await createServerSide();
      return fetchOf(ssr.createServerClient);
    },
  ],
])('%s', (_name, build) => {
  test('sends a REST request again after PostgREST refused the token for its stale clock', async () => {
    vi.useFakeTimers();
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(staleClock())
      .mockResolvedValueOnce(ok());

    const clientFetch = await build();
    expect(clientFetch).toBeTypeOf('function');
    const pending = clientFetch!(REST);
    await vi.runAllTimersAsync();

    expect((await pending).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(2);
  });
});
