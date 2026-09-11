import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { fetchHostSettings, type HostSettings } from '../api';
import { useGalleryAllowed } from '../use-host';

jest.mock('../api', () => ({ fetchHostSettings: jest.fn() }));

const fetchSettings = fetchHostSettings as jest.MockedFunction<typeof fetchHostSettings>;

function wrapper({ children }: { children: ReactNode }) {
  // gcTime 0: the cache keeps a collection timer per query, and a test that
  // leaves one behind holds the jest worker open after the run.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// The restrictive reading is the safe one: a gallery button the company never
// allowed would let through exactly the file the setting exists to keep out.
test('the gallery is closed while nobody has answered yet', async () => {
  let answer = (settings: HostSettings) => {
    void settings;
  };
  fetchSettings.mockReturnValue(
    new Promise<HostSettings>((resolve) => {
      answer = resolve;
    }),
  );

  const { result } = await renderHook(() => useGalleryAllowed(), { wrapper });

  expect(result.current).toBe(false);

  // Let the query finish rather than leaving it hanging past the test.
  answer({ id: 'h1', gallery_allowed: true });
  await waitFor(() => expect(result.current).toBe(true));
});

test('and closed when the read failed', async () => {
  fetchSettings.mockRejectedValue(new Error('offline'));

  const { result } = await renderHook(() => useGalleryAllowed(), { wrapper });

  await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
  expect(result.current).toBe(false);
});

test('it opens only when the company says so', async () => {
  fetchSettings.mockResolvedValue({ id: 'h1', gallery_allowed: true });

  const { result } = await renderHook(() => useGalleryAllowed(), { wrapper });

  await waitFor(() => expect(result.current).toBe(true));
});

test('and stays closed when it says not', async () => {
  fetchSettings.mockResolvedValue({ id: 'h1', gallery_allowed: false });

  const { result } = await renderHook(() => useGalleryAllowed(), { wrapper });

  await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
  expect(result.current).toBe(false);
});
