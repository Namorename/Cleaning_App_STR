import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { teamKeys } from '../keys';
import type { StaffDraft } from '../schema';
import { useSaveStaff } from '../use-team';

const client = {
  functions: { invoke: vi.fn() },
};

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => client }));

const DRAFT: StaffDraft = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
  fullName: 'Petr Dvořák',
  email: 'petr@example.com',
  phone: '',
  role: 'tech',
  language: 'cs',
  isActive: false,
};

function renderWithCache<T>(hook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(hook, { wrapper }), invalidate };
}

describe('saving a person', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // manage-staff writes the profile row before app_metadata. When the second
  // write fails the row is already changed, and a list left on the old cache
  // would keep showing the old role and the old switch until the next read.
  it('refreshes the team when the save fails after the profile was written', async () => {
    client.functions.invoke.mockResolvedValue({
      data: null,
      error: new Error('app_metadata update failed'),
    });
    const { result, invalidate } = renderWithCache(() => useSaveStaff());

    await act(async () => {
      await expect(result.current.mutateAsync(DRAFT)).rejects.toBeTruthy();
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: teamKeys.all });
  });

  it('refreshes the team after a save that worked', async () => {
    client.functions.invoke.mockResolvedValue({ data: { data: { id: DRAFT.id } }, error: null });
    const { result, invalidate } = renderWithCache(() => useSaveStaff());

    await act(async () => {
      await result.current.mutateAsync(DRAFT);
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: teamKeys.all });
  });
});
