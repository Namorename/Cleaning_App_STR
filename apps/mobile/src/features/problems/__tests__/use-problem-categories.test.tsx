import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { AppRole } from '@str-ops/shared';
import type { ReactNode } from 'react';

import { fetchHostSettings } from '@/features/host/api';
import { hostKeys } from '@/features/host/keys';
import type { HostSettings } from '@/features/host/schema';
import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { fetchProblemCategories } from '../api';
import type { ProblemCategory } from '../categories';
import { problemCategoryKeys } from '../keys';
import { useReportCatalog } from '../use-problem-categories';

/**
 * Who picks a category, and what happens without a connection: the catalogue
 * is the cleaner's alone, only where the company reports by catalogue, from the
 * phone's disk when there is no network — and the typed title whenever the
 * phone has never had the list, so a report is never held up by it.
 */

let mockRole: AppRole | null = 'cleaner';

jest.mock('@/features/auth/use-role', () => ({ useRole: () => mockRole }));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'me' }) }));
jest.mock('@/features/host/api', () => ({ fetchHostSettings: jest.fn() }));
jest.mock('../api', () => ({ fetchProblemCategories: jest.fn() }));

const fetchSettings = fetchHostSettings as jest.MockedFunction<typeof fetchHostSettings>;
const fetchCategories = fetchProblemCategories as jest.MockedFunction<
  typeof fetchProblemCategories
>;

const CATEGORIES: ProblemCategory[] = [
  {
    id: '83ffda56-635c-4941-bedd-cb08b82e6675',
    name: 'Горячая вода',
    name_i18n: { en: 'Hot water' },
    synonyms: ['бойлер'],
    priority: 'high',
  },
];

function company(mode: HostSettings['problem_report_mode']): HostSettings {
  return {
    id: 'h1',
    gallery_allowed: false,
    video_max_sec: 90,
    video_bitrate_kbps: 2000,
    video_max_mb: 45,
    problem_report_mode: mode,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'cleaner';
});

test('a cleaner of a company that reports by catalogue gets the list', async () => {
  fetchSettings.mockResolvedValue(company('catalog'));
  fetchCategories.mockResolvedValue(CATEGORIES);

  const { result } = await renderHook(() => useReportCatalog(), { wrapper });

  await waitFor(() => expect(result.current).toEqual(CATEGORIES));
});

test('a company that types titles: no list, and nothing is asked for', async () => {
  fetchSettings.mockResolvedValue(company('free_text'));
  fetchCategories.mockResolvedValue(CATEGORIES);

  const { result } = await renderHook(() => useReportCatalog(), { wrapper });

  await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
  expect(result.current).toBeNull();
  expect(fetchCategories).not.toHaveBeenCalled();
});

test.each<AppRole>(['tech', 'head_tech', 'manager', 'admin'])(
  'a %s types the title as before, whatever the company',
  async (role) => {
    mockRole = role;
    fetchSettings.mockResolvedValue(company('catalog'));
    fetchCategories.mockResolvedValue(CATEGORIES);

    const { result } = await renderHook(() => useReportCatalog(), { wrapper });

    await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(fetchCategories).not.toHaveBeenCalled();
  },
);

test('without a connection and without a copy on the phone: the typed title', async () => {
  fetchSettings.mockResolvedValue(company('catalog'));
  fetchCategories.mockRejectedValue(new Error('Network request failed'));

  const { result } = await renderHook(() => useReportCatalog(), { wrapper });

  await waitFor(() => expect(fetchCategories).toHaveBeenCalled());
  expect(result.current).toBeNull();
});

test('while the first read is on its way: the typed title, not a wait', async () => {
  fetchSettings.mockResolvedValue(company('catalog'));
  let answer = (categories: ProblemCategory[]) => {
    void categories;
  };
  fetchCategories.mockReturnValue(
    new Promise<ProblemCategory[]>((resolve) => {
      answer = resolve;
    }),
  );

  const { result } = await renderHook(() => useReportCatalog(), { wrapper });

  await waitFor(() => expect(fetchCategories).toHaveBeenCalled());
  expect(result.current).toBeNull();

  answer(CATEGORIES);
  await waitFor(() => expect(result.current).toEqual(CATEGORIES));
});

test('without a connection, the copy on the phone is offered', async () => {
  // Arrange: the list as the persister brought it back, the company read before.
  const client = restoredFromDisk(problemCategoryKeys.all, CATEGORIES);
  client.setQueryData(hostKeys.settings(), company('catalog'));
  fetchSettings.mockRejectedValue(new Error('Network request failed'));
  fetchCategories.mockRejectedValue(new Error('Network request failed'));

  // Act
  const { result } = await renderHook(() => useReportCatalog(), { wrapper: withClient(client) });

  // Assert
  expect(result.current).toEqual(CATEGORIES);
  client.clear();
});

test('an empty catalogue is no way to report: the typed title', async () => {
  fetchSettings.mockResolvedValue(company('catalog'));
  fetchCategories.mockResolvedValue([]);

  const { result } = await renderHook(() => useReportCatalog(), { wrapper });

  await waitFor(() => expect(fetchCategories).toHaveBeenCalled());
  expect(result.current).toBeNull();
});

test('a copy saved before the switch existed reads as the typed title', async () => {
  const client = restoredFromDisk(hostKeys.settings(), { id: 'h1', gallery_allowed: false });
  fetchSettings.mockRejectedValue(new Error('Network request failed'));

  const { result } = await renderHook(() => useReportCatalog(), { wrapper: withClient(client) });

  expect(result.current).toBeNull();
  expect(fetchCategories).not.toHaveBeenCalled();
  client.clear();
});
