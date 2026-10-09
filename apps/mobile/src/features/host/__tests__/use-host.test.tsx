import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { fetchHostSettings } from '../api';
import { hostKeys } from '../keys';
import type { HostSettings } from '../schema';
import { useGalleryAllowed, useVideoSettings } from '../use-host';

jest.mock('../api', () => ({ fetchHostSettings: jest.fn() }));

const fetchSettings = fetchHostSettings as jest.MockedFunction<typeof fetchHostSettings>;

/** The company as the server answers today: gallery shut, video at its defaults but the length. */
function company(overrides: Partial<HostSettings> = {}): HostSettings {
  return {
    id: 'h1',
    gallery_allowed: false,
    video_max_sec: 90,
    video_bitrate_kbps: 2000,
    video_max_mb: 45,
    ...overrides,
  };
}

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
  answer(company({ gallery_allowed: true }));
  await waitFor(() => expect(result.current).toBe(true));
});

test('and closed when the read failed', async () => {
  fetchSettings.mockRejectedValue(new Error('offline'));

  const { result } = await renderHook(() => useGalleryAllowed(), { wrapper });

  await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
  expect(result.current).toBe(false);
});

test('it opens only when the company says so', async () => {
  fetchSettings.mockResolvedValue(company({ gallery_allowed: true }));

  const { result } = await renderHook(() => useGalleryAllowed(), { wrapper });

  await waitFor(() => expect(result.current).toBe(true));
});

test('and stays closed when it says not', async () => {
  fetchSettings.mockResolvedValue(company({ gallery_allowed: false }));

  const { result } = await renderHook(() => useGalleryAllowed(), { wrapper });

  await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
  expect(result.current).toBe(false);
});

// The length, the bitrate and the size of a recording are the company's
// (docs/tech-plan.md §7.1). A phone that has never heard them does not guess:
// a guess longer than the company allows is a recording the server refuses
// after she has waited for its upload.
describe('the video settings', () => {
  test('are unknown until the company has answered, then its own', async () => {
    let answer = (settings: HostSettings) => {
      void settings;
    };
    fetchSettings.mockReturnValue(
      new Promise<HostSettings>((resolve) => {
        answer = resolve;
      }),
    );

    const { result } = await renderHook(() => useVideoSettings(), { wrapper });

    expect(result.current).toBeNull();

    answer(company());
    await waitFor(() =>
      expect(result.current).toEqual({
        video_max_sec: 90,
        video_bitrate_kbps: 2000,
        video_max_mb: 45,
      }),
    );
  });

  test('and stay unknown when the read failed with nothing saved', async () => {
    fetchSettings.mockRejectedValue(new Error('offline'));

    const { result } = await renderHook(() => useVideoSettings(), { wrapper });

    await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  // The build before this one saved the company without its video numbers.
  // Read through the schema, that row still opens the gallery as it did; its
  // video numbers are unknown, not guessed — a default passed off as the
  // company's (120 s where it set 90) is a recording the server refuses after
  // she has waited for its upload.
  test('a company saved by the build before video still opens the gallery, its video unknown', async () => {
    // Arrange: the refresh never answers, so the hooks read what the disk gave.
    fetchSettings.mockReturnValue(new Promise(() => {}));
    const client = restoredFromDisk(hostKeys.settings(), { id: 'h1', gallery_allowed: true });

    // Act
    const video = await renderHook(() => useVideoSettings(), { wrapper: withClient(client) });
    const gallery = await renderHook(() => useGalleryAllowed(), { wrapper: withClient(client) });

    // Assert
    expect(video.result.current).toBeNull();
    expect(gallery.result.current).toBe(true);
  });

  // Saved a minute ago, the old row is fresh by the hour the settings are
  // kept for — but it lacks what this build needs, so it is asked for at once.
  test('a company saved without its video numbers is read again at once, then known', async () => {
    // Arrange
    fetchSettings.mockResolvedValue(company({ gallery_allowed: true }));
    const client = restoredFromDisk(hostKeys.settings(), { id: 'h1', gallery_allowed: true });

    // Act
    const { result } = await renderHook(() => useVideoSettings(), { wrapper: withClient(client) });

    // Assert
    await waitFor(() =>
      expect(result.current).toEqual({
        video_max_sec: 90,
        video_bitrate_kbps: 2000,
        video_max_mb: 45,
      }),
    );
    expect(fetchSettings).toHaveBeenCalledTimes(1);
  });

  // A whole row, saved a minute ago, is not asked for again within the hour.
  test('a company saved with its video numbers is not read again before the hour', async () => {
    fetchSettings.mockResolvedValue(company());
    const client = restoredFromDisk(hostKeys.settings(), company());

    const { result } = await renderHook(() => useVideoSettings(), { wrapper: withClient(client) });

    expect(result.current).toEqual({
      video_max_sec: 90,
      video_bitrate_kbps: 2000,
      video_max_mb: 45,
    });
    expect(fetchSettings).not.toHaveBeenCalled();
  });
});
