import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

const fetchReportCatalog = vi.fn();
vi.mock('../catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../catalog')>()),
  fetchReportCatalog: () => fetchReportCatalog(),
}));

import { useReportCatalog } from '../use-problems';

/**
 * «Новое задание» is never held up by the catalogue (owner, 2026-11-20): a read that fails gives
 * the typed title at once — not after the panel's usual retry — and a form opened after the
 * failure takes it as it stands instead of waiting on a read again. Through the real hook and a
 * cache set up as the panel's (providers.tsx: retry 1).
 */

function panelCache() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });
}

/** The page's reader by default; `isForm` for the form's own. */
function renderCatalog(cache: QueryClient, isForm = false) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  return renderHook(() => useReportCatalog({ isForm }), { wrapper });
}

/** Longer than the cache's retry delay (1 s for the first retry). */
const PAST_A_RETRY_MS = 1_300;

beforeEach(() => {
  fetchReportCatalog.mockReset();
});

describe('the catalogue for «Новое задание»', () => {
  test('a failed read gives the typed title at once, with no retry', async () => {
    fetchReportCatalog.mockRejectedValue(new Error('AbortError: aborted'));
    const cache = panelCache();
    const { result } = renderCatalog(cache);

    expect(result.current.kind).toBe('pending');
    await waitFor(() => expect(result.current.kind).toBe('free'));
    await new Promise((resolve) => setTimeout(resolve, PAST_A_RETRY_MS));
    expect(fetchReportCatalog).toHaveBeenCalledTimes(1);
  });

  test('a form opened after the failure takes it as it stands', async () => {
    fetchReportCatalog.mockRejectedValue(new Error('AbortError: aborted'));
    const cache = panelCache();
    const page = renderCatalog(cache);
    await waitFor(() => expect(page.result.current.kind).toBe('free'));

    // The form mounts its own reader of the same answer.
    const form = renderCatalog(cache, true);
    expect(form.result.current.kind).toBe('free');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(form.result.current.kind).toBe('free');
    expect(fetchReportCatalog).toHaveBeenCalledTimes(1);
  });

  test('the page opened anew after a failure reads again, and recovers', async () => {
    fetchReportCatalog.mockRejectedValueOnce(new Error('AbortError: aborted'));
    const cache = panelCache();
    const first = renderCatalog(cache);
    await waitFor(() => expect(first.result.current.kind).toBe('free'));
    first.unmount();

    const categories = [
      {
        id: 'd2e00844-d88c-4324-ab60-dbed5bb56a59',
        name: 'Затопление',
        name_i18n: {},
        synonyms: [],
        priority: 'high',
        critical: true,
      },
    ];
    fetchReportCatalog.mockResolvedValue({ mode: 'catalog', categories });
    const again = renderCatalog(cache);

    await waitFor(() => expect(again.result.current).toEqual({ kind: 'catalog', categories }));
    expect(fetchReportCatalog).toHaveBeenCalledTimes(2);
  });

  test('a company that picks gets its list', async () => {
    const categories = [
      {
        id: 'd2e00844-d88c-4324-ab60-dbed5bb56a59',
        name: 'Затопление',
        name_i18n: {},
        synonyms: [],
        priority: 'high',
        critical: true,
      },
    ];
    fetchReportCatalog.mockResolvedValue({ mode: 'catalog', categories });
    const { result } = renderCatalog(panelCache());

    await waitFor(() => expect(result.current).toEqual({ kind: 'catalog', categories }));
  });

  test('a company that types gets the form of before', async () => {
    fetchReportCatalog.mockResolvedValue({ mode: 'free_text', categories: [] });
    const { result } = renderCatalog(panelCache());

    await waitFor(() => expect(result.current).toEqual({ kind: 'free' }));
  });
});
