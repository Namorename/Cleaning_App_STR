import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { supplyKeys } from '../keys';
import { useReviewSupplyRequest } from '../use-supplies';

const client = { rpc: vi.fn() };

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => client }));

const REQUEST = '55555555-5555-4555-8555-555555555555';

function renderWithCache<T>(hook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(hook, { wrapper }), invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a move over a request', () => {
  // A colleague or the cleaner's phone moved the request first: the server
  // refuses, and the buttons of the old status must not stay on screen.
  test('a refusal reads the list again, so the request shows its real status', async () => {
    client.rpc.mockResolvedValue({
      data: null,
      error: { message: 'status changed meanwhile', hint: null, details: null },
    });
    const { result, invalidate } = renderWithCache(() => useReviewSupplyRequest());

    await act(async () => {
      await expect(
        result.current.mutateAsync({ requestId: REQUEST, status: 'accepted' }),
      ).rejects.toBeTruthy();
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: supplyKeys.list() });
    // The refusal stays to be shown under the buttons.
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  test('a move that went through reads the list again too', async () => {
    // The RPC returns the bare row, without the joins of the list.
    client.rpc.mockResolvedValue({
      data: {
        id: REQUEST,
        requested_by: '22222222-2222-4222-8222-222222222222',
        property_id: 1,
        task_id: null,
        status: 'accepted',
        priority: 'normal',
        note: null,
        needed_by: null,
        reviewed_at: '2026-09-09T12:00:00+00:00',
        fulfilled_at: null,
        reject_reason: null,
        created_at: '2026-09-09T10:00:00+00:00',
      },
      error: null,
    });
    const { result, invalidate } = renderWithCache(() => useReviewSupplyRequest());

    await act(async () => {
      await result.current.mutateAsync({ requestId: REQUEST, status: 'accepted' });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: supplyKeys.list() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
