import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/** A save the test answers by hand. */
interface Pending {
  tabIds: readonly string[];
  resolve: (stored: string[]) => void;
  reject: (error: unknown) => void;
}
const pending: Pending[] = [];
const fetchBoardTabOrder = vi.fn(async (): Promise<string[] | null> => null);
const saveBoardTabOrder = vi.fn(
  (_client: unknown, tabIds: readonly string[]) =>
    new Promise<string[]>((resolve, reject) => {
      pending.push({ tabIds, resolve, reject });
    }),
);

vi.mock('../tab-order-api', () => ({
  fetchBoardTabOrder: () => fetchBoardTabOrder(),
  saveBoardTabOrder: (client: unknown, tabIds: readonly string[]) =>
    saveBoardTabOrder(client, tabIds),
}));
vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

import { TAB_ORDER_SAVE_DELAY_MS, useBoardTabOrder } from '../use-tab-order';

const TABS = ['tech', 'mine', 'b0a2d100-0000-4000-8000-000000000001'];
const BOARD = TABS[2];

function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(({ viewer }: { viewer: string }) => useBoardTabOrder(viewer, TABS), {
    wrapper,
    initialProps: { viewer: 'viewer-1' },
  });
  return { ...view, client };
}

/** The save's delay, waited out for real: Testing Library's waits need real timers. */
async function waitTheDelay() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, TAB_ORDER_SAVE_DELAY_MS + 50));
  });
}

async function ready(result: { current: { isReady: boolean } }) {
  await waitFor(() => expect(result.current.isReady).toBe(true));
}

beforeEach(() => {
  pending.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useBoardTabOrder', () => {
  test('is not ready to change until her order has been read', async () => {
    let answer: (ids: string[] | null) => void = () => {};
    fetchBoardTabOrder.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { result } = mount();
    expect(result.current.isReady).toBe(false);
    expect(result.current.order).toEqual(TABS);

    await act(async () => answer([BOARD, 'tech']));
    await ready(result);
    expect(result.current.order).toEqual([BOARD, 'tech', 'mine']);
  });

  test('an order that cannot be read is never ready: a move would overwrite hers', async () => {
    fetchBoardTabOrder.mockRejectedValueOnce(new Error('401'));
    const { result } = mount();
    await waitFor(() => expect(fetchBoardTabOrder).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.isReady).toBe(false);
    expect(result.current.order).toEqual(TABS);
  });

  test('a change saves after the delay; leaving the page saves what waits at once', async () => {
    const { result, unmount } = mount();
    await ready(result);

    act(() => result.current.change([BOARD, 'tech', 'mine']));
    expect(result.current.order).toEqual([BOARD, 'tech', 'mine']);
    expect(saveBoardTabOrder).not.toHaveBeenCalled();
    await waitTheDelay();
    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(1));

    act(() => result.current.change(['mine', BOARD, 'tech']));
    unmount();
    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(1));
    await act(async () => pending[0].resolve([BOARD, 'tech', 'mine']));
    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(2));
    expect(saveBoardTabOrder.mock.calls[1][1]).toEqual(['mine', BOARD, 'tech']);
  });

  test('a page hidden — a tab being closed — saves what waits at once', async () => {
    const { result } = mount();
    await ready(result);
    act(() => result.current.change([BOARD, 'mine', 'tech']));

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();

    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(1));
    expect(saveBoardTabOrder.mock.calls[0][1]).toEqual([BOARD, 'mine', 'tech']);
  });

  test('saves go one after another: the server keeps the last order', async () => {
    const { result } = mount();
    await ready(result);

    act(() => result.current.change([BOARD, 'tech', 'mine']));
    await waitTheDelay();
    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(1));
    act(() => result.current.change(['mine', 'tech', BOARD]));
    await waitTheDelay();
    await act(async () => {});
    expect(saveBoardTabOrder).toHaveBeenCalledTimes(1);

    await act(async () => pending[0].resolve([BOARD, 'tech', 'mine']));
    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(2));
    await act(async () => pending[1].resolve(['mine', 'tech', BOARD]));
    await waitFor(() => expect(result.current.order).toEqual(['mine', 'tech', BOARD]));
  });

  test('an older save that fails while a newer change waits leaves the newer one, and says nothing', async () => {
    const { result } = mount();
    await ready(result);

    act(() => result.current.change([BOARD, 'tech', 'mine']));
    await waitTheDelay();
    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(1));
    act(() => result.current.change(['mine', BOARD, 'tech']));
    await act(async () => pending[0].reject(new Error('offline')));

    expect(result.current.order).toEqual(['mine', BOARD, 'tech']);
    expect(result.current.failure).toBeNull();
  });

  test('the newest save failing brings the saved order back and says why', async () => {
    fetchBoardTabOrder.mockResolvedValueOnce(['mine', 'tech', BOARD]);
    const { result } = mount();
    await ready(result);

    act(() => result.current.change([BOARD, 'mine', 'tech']));
    await waitTheDelay();
    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(1));
    await act(async () => pending[0].reject(new Error('offline')));

    expect(result.current.order).toEqual(['mine', 'tech', BOARD]);
    expect(result.current.failure).not.toBeNull();
  });

  test("each person's order is read for her: another person in the same browser reads afresh", async () => {
    fetchBoardTabOrder.mockResolvedValueOnce([BOARD, 'tech']);
    const { result, rerender } = mount();
    await ready(result);
    expect(result.current.order).toEqual([BOARD, 'tech', 'mine']);

    fetchBoardTabOrder.mockResolvedValueOnce(null);
    rerender({ viewer: 'viewer-2' });
    await waitFor(() => expect(fetchBoardTabOrder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.order).toEqual(TABS));
  });
});
