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

/** «Назад»: jsdom walks the history a task later and says so with `popstate`. */
function goBack(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.back();
  });
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

  // Owner, 04.10: a new tab is a step «Назад» walks back; a filter is not.
  test('a change written as a step is pushed, and «Назад» brings the value before it back', async () => {
    const { result, rerender } = renderTab();
    const before = window.history.length;

    act(() => result.current[1]('closed', 'push'));
    expect(window.history.length).toBe(before + 1);
    expect(window.location.search).toBe('?tab=closed');
    // The push's own echo.
    router.search = 'tab=closed';
    rerender();
    expect(result.current[0]).toBe('closed');

    // «Назад»: the window and then the router move to the step before.
    await goBack();
    expect(window.location.search).toBe('');
    router.search = '';
    rerender();
    expect(result.current[0]).toBe('today');
  });

  test('a change replaced after a step stays on that step: «Назад» skips it', async () => {
    const { result, rerender } = renderTab();
    act(() => result.current[1]('closed', 'push'));
    const steps = window.history.length;
    router.search = 'tab=closed';
    rerender();

    act(() => result.current[1]('upcoming'));
    expect(window.history.length).toBe(steps);
    router.search = 'tab=upcoming';
    rerender();
    expect(result.current[0]).toBe('upcoming');

    await goBack();
    router.search = '';
    rerender();
    expect(result.current[0]).toBe('today');
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

  // The review of 2026-10-04: a change undone before the router showed it is
  // never shown at all — the router catches up with the last write only. What
  // was written then must not pass for an echo when a link brings it later.
  test('a write the router never showed is not taken for an echo later', () => {
    const { result, rerender } = renderTab();
    act(() => result.current[1]('upcoming'));
    act(() => result.current[1]('today'));
    rerender();
    expect(result.current[0]).toBe('today');

    // A link to the same query, a while later: Next moves the address and the router.
    window.history.replaceState(null, '', '/tasks?tab=upcoming');
    router.search = 'tab=upcoming';
    rerender();
    expect(result.current[0]).toBe('upcoming');
  });

  test('the address keeps its anchor when the state is written', () => {
    window.history.replaceState(null, '', '/tasks#today');
    const { result } = renderTab();

    act(() => result.current[1]('upcoming'));

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/tasks?tab=upcoming#today',
    );
  });
});
