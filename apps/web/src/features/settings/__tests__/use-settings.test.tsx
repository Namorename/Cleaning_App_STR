import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { HostSettings } from '../schema';

const api = vi.hoisted(() => ({ fetchHostSettings: vi.fn(), saveHostSettings: vi.fn() }));

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));
vi.mock('../api', () => api);

import { useHostSettings, useSaveHostSettings } from '../use-settings';

const before: HostSettings = {
  id: 'h1',
  name: 'Primary host',
  parallel_start_allowed: true,
  gallery_allowed: false,
  video_max_sec: 120,
  video_bitrate_kbps: 2000,
  video_max_mb: 45,
};
const after: HostSettings = { ...before, video_max_sec: 90 };

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => ({ settings: useHostSettings(), save: useSaveHostSettings() }), {
    wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saving the company settings', () => {
  // The video form drops its draft when the save succeeds. Were the save
  // reported before the company was read again, the fields would show the old
  // numbers for a moment, and then the new ones.
  test('is not reported done until the company has been read again', async () => {
    let answer: (host: HostSettings) => void = () => undefined;
    api.fetchHostSettings
      .mockResolvedValueOnce(before)
      .mockImplementationOnce(() => new Promise<HostSettings>((resolve) => (answer = resolve)));
    api.saveHostSettings.mockResolvedValue(undefined);
    const { result } = renderSettings();
    await waitFor(() => expect(result.current.settings.data).toEqual(before));

    act(() => result.current.save.mutate({ videoMaxSec: 90 }));
    await waitFor(() => expect(api.fetchHostSettings).toHaveBeenCalledTimes(2));

    expect(result.current.save.isSuccess).toBe(false);

    await act(async () => answer(after));
    await waitFor(() => expect(result.current.save.isSuccess).toBe(true));
    expect(result.current.settings.data).toEqual(after);
  });
});
