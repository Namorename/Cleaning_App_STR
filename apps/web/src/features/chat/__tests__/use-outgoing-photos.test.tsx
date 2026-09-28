import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { attachMessagePhoto } from '../media';
import { useOutgoingPhotos } from '../use-outgoing-photos';

/**
 * The photos of one message go out together, one mutation each, through one
 * hook. TanStack drops the per-call callbacks of an earlier mutate() once a
 * later one is made, so a photo that is not the last of its message has to
 * keep its own promise — or its failure is never shown and its tile spins for
 * ever. Real TanStack here; only the chain to the server is replaced.
 */

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));
vi.mock('../media', () => ({
  attachMessagePhoto: vi.fn(),
  removeMessagePhoto: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const draft = (id: string) => ({
  id,
  file: new File(['x'], `${id}.jpg`, { type: 'image/jpeg' }),
  previewUrl: `blob:${id}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  URL.revokeObjectURL = vi.fn();
});

test('a photo that fails before the last one of its message is said to have failed', async () => {
  // Arrange: the first photo is refused, the second goes through.
  vi.mocked(attachMessagePhoto).mockImplementation((_client, variables) =>
    variables.mediaId === 'first'
      ? Promise.reject(new Error('unreadable'))
      : Promise.resolve({} as never),
  );
  const { result } = renderHook(() => useOutgoingPhotos(), { wrapper });

  // Act
  act(() => result.current.start('message-1', [draft('first'), draft('second')]));

  // Assert: the first can be tried again or removed; the second is done.
  await waitFor(() => expect(result.current.states.get('first')?.status).toBe('failed'));
  await waitFor(() => expect(result.current.states.has('second')).toBe(false));
});

test('every photo that went through is let go, not only the last', async () => {
  vi.mocked(attachMessagePhoto).mockResolvedValue({} as never);
  const { result } = renderHook(() => useOutgoingPhotos(), { wrapper });

  act(() => result.current.start('message-1', [draft('a'), draft('b'), draft('c')]));

  await waitFor(() => expect(result.current.states.size).toBe(0));
});
