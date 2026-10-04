import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// What Next's router believes the query is. It catches up with
// `history.replaceState` a transition later, so a test can hold it back.
const router = { search: '' };
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(router.search),
  usePathname: () => '/tasks',
}));

import { useAddressState } from '../use-address-state';

/** A one-field state: the tab, `today` unless the address says otherwise. */
const readTab = (params: URLSearchParams) => params.get('tab') ?? 'today';
const writeTab = (tab: string) => (tab === 'today' ? '' : new URLSearchParams({ tab }).toString());

function renderTab() {
  return renderHook(() => useAddressState(readTab, writeTab));
}

beforeEach(() => {
  router.search = '';
  window.history.replaceState(null, '', '/tasks');
});

describe('useAddressState', () => {
  test('starts from what the address says', () => {
    router.search = 'tab=closed';

    const { result } = renderTab();

    expect(result.current[0]).toBe('closed');
  });

  test('a change is written into the address, in place, the default as a bare path', () => {
    const { result } = renderTab();
    const before = window.history.length;

    act(() => result.current[1]('upcoming'));
    expect(result.current[0]).toBe('upcoming');
    expect(`${window.location.pathname}${window.location.search}`).toBe('/tasks?tab=upcoming');

    act(() => result.current[1]('today'));
    expect(`${window.location.pathname}${window.location.search}`).toBe('/tasks');
    // Replaced, not pushed: «Назад» leaves the page rather than walking its filters.
    expect(window.history.length).toBe(before);
  });

  test('its own writes coming back late never undo a newer change', () => {
    const { result, rerender } = renderTab();

    act(() => result.current[1]('upcoming'));
    act(() => result.current[1]('closed'));

    // The router catches up one write at a time.
    router.search = 'tab=upcoming';
    rerender();
    expect(result.current[0]).toBe('closed');

    router.search = 'tab=closed';
    rerender();
    expect(result.current[0]).toBe('closed');
  });

  test('an address it did not write wins: a link to the page, «Назад»', () => {
    const { result, rerender } = renderTab();
    act(() => result.current[1]('closed'));
    router.search = 'tab=closed';
    rerender();

    // The menu's «Уборки» leads to the bare page.
    router.search = '';
    rerender();
    expect(result.current[0]).toBe('today');

    router.search = 'tab=upcoming';
    rerender();
    expect(result.current[0]).toBe('upcoming');
  });
});
