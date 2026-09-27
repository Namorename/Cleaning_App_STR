import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apartmentKeys } from '../keys';
import { useSaveInfo, useSyncListings } from '../use-apartments';

const client = {
  from: vi.fn(),
  functions: { invoke: vi.fn() },
};

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => client }));

const DRAFT = {
  parentId: null,
  hasParentChoice: true,
  cleanerNotes: 'Keys in the box',
  internalNotes: 'Owner visits in May',
};

function renderWithCache<T>(hook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(hook, { wrapper }), invalidate };
}

describe('saving what the office owns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes the cache when the note fails after the row was saved', async () => {
    client.from.mockImplementation((table: string) =>
      table === 'properties'
        ? { update: () => ({ eq: async () => ({ error: null }) }) }
        : { upsert: async () => ({ error: { message: 'permission denied' } }) },
    );
    const { result, invalidate } = renderWithCache(() => useSaveInfo(7));

    await act(async () => {
      await expect(result.current.mutateAsync(DRAFT)).rejects.toBeTruthy();
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: apartmentKeys.all });
  });

  it('refreshes the cache when a sync fails partway', async () => {
    client.functions.invoke.mockResolvedValue({ data: null, error: new Error('timeout') });
    const { result, invalidate } = renderWithCache(() => useSyncListings());

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toBeTruthy();
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: apartmentKeys.all });
  });
});
