import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

const fetchCalendarBookings = vi.fn();
vi.mock('../api', () => ({
  fetchCalendarBookings: (...args: unknown[]) => fetchCalendarBookings(...args),
}));

const fetchTasksBetween = vi.fn();
const fetchExpiredBetween = vi.fn();
vi.mock('@/features/tasks/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tasks/api')>()),
  fetchTasksBetween: (...args: unknown[]) => fetchTasksBetween(...args),
  fetchExpiredBetween: (...args: unknown[]) => fetchExpiredBetween(...args),
}));

import { act } from '@testing-library/react';

import { pastChunk, windowDays } from '../dates';
import type { CalendarBooking } from '../schema';
import { useCalendarBookings, useCalendarPastLoader } from '../use-calendar';

/**
 * The bookings layer is read month by month (docs/f10-plan.md, §1): the
 * arrows then reuse what they have read, and the months next to the window
 * are read ahead of the arrow that reaches them.
 */

const booking = (id: number, arrival: string, departure: string): CalendarBooking => ({
  id,
  property_id: 1,
  arrival_date: arrival,
  departure_date: departure,
  status: 'new',
  is_block: false,
  guest_name: `Guest ${id}`,
  guests_count: 2,
  check_in_time: null,
  check_out_time: null,
  rooms: [],
  is_service_booking: false,
});

function renderWithCache<T>(hook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper });
}

const asked = () =>
  fetchCalendarBookings.mock.calls.map((call) => `${String(call[1])}..${String(call[2])}`).sort();

// One client for the page’s life, as the panel’s own hook hands out.
const CLIENT = {} as never;

// 28 September to 4 October: two months.
const DAYS = windowDays('2026-09-28', 7);

beforeEach(() => {
  fetchCalendarBookings.mockReset();
  fetchTasksBetween.mockReset();
  fetchExpiredBetween.mockReset();
});

describe('the bookings of the window', () => {
  test('each month is read once, and a stay across the turn of the month is kept once', async () => {
    const across = booking(1, '2026-09-29', '2026-10-03');
    fetchCalendarBookings.mockImplementation(async (_client: unknown, from: string) =>
      from === '2026-09-01'
        ? [across]
        : from === '2026-10-01'
          ? [across, booking(2, '2026-10-02', '2026-10-04')]
          : [],
    );

    const { result } = renderWithCache(() => useCalendarBookings({} as never, false, DAYS));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.map((one) => one.id)).toEqual([1, 2]);
  });

  test('the months on either side are read ahead', async () => {
    fetchCalendarBookings.mockResolvedValue([]);

    renderWithCache(() => useCalendarBookings({} as never, false, DAYS));

    await waitFor(() =>
      expect(asked()).toEqual([
        '2026-08-01..2026-09-01',
        '2026-09-01..2026-10-01',
        '2026-10-01..2026-11-01',
        '2026-11-01..2026-12-01',
      ]),
    );
  });

  // Half the bookings of a window would read as free nights.
  test('one month that fails fails the layer, and nothing is shown of the rest', async () => {
    const failure = { message: 'canceling statement due to statement timeout' };
    fetchCalendarBookings.mockImplementation(async (_client: unknown, from: string) => {
      if (from === '2026-10-01') {
        throw failure;
      }
      return [booking(1, '2026-09-28', '2026-09-30')];
    });

    const { result } = renderWithCache(() => useCalendarBookings({} as never, false, DAYS));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  test('nothing is asked before there is a client', () => {
    renderWithCache(() => useCalendarBookings(null, false, DAYS));

    expect(fetchCalendarBookings).not.toHaveBeenCalled();
  });

  // Block 7: the past shown is read, but nothing is read ahead of it — the
  // month before the past is only asked when the past reaches it.
  test('the months ahead are the window’s, not the past’s shown before it', async () => {
    fetchCalendarBookings.mockResolvedValue([]);
    const week = windowDays('2026-10-09', 7);
    const past = [...pastChunk('2026-09-25', '2026-10-10'), ...pastChunk('2026-10-09', '2026-10-10')];

    renderWithCache(() => useCalendarBookings(CLIENT, false, [...past, ...week], week));

    await waitFor(() => expect(fetchCalendarBookings).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked()).toEqual([
      '2026-09-01..2026-10-01',
      '2026-10-01..2026-11-01',
      '2026-11-01..2026-12-01',
    ]);
  });
});

/**
 * A chunk of the past (block 7) is read before it is shown: every layer its
 * days draw, for the months they touch — what the screen already holds is
 * not asked again.
 */
describe('the loader of the past', () => {
  const CHUNK = pastChunk('2026-10-09', '2026-10-10');
  const tasksAsked = (taskClass: string) =>
    fetchTasksBetween.mock.calls
      .filter((call) => call[3] === taskClass)
      .map((call) => `${String(call[1])}..${String(call[2])}`)
      .sort();
  const expiredAsked = () =>
    fetchExpiredBetween.mock.calls.map((call) => `${String(call[1])}..${String(call[2])}`).sort();

  beforeEach(() => {
    fetchCalendarBookings.mockResolvedValue([]);
    fetchTasksBetween.mockResolvedValue([]);
    fetchExpiredBetween.mockResolvedValue([]);
  });

  test('reads the bars, the live and the done, what never happened and the cancelled of its months', async () => {
    const { result } = renderWithCache(() => useCalendarPastLoader(CLIENT, false));

    await act(async () => {
      await result.current(CHUNK);
    });

    const months = ['2026-09-01..2026-10-01', '2026-10-01..2026-11-01'];
    expect(asked()).toEqual(months);
    expect(tasksAsked('active')).toEqual(months);
    expect(tasksAsked('cancelled')).toEqual(months);
    expect(expiredAsked()).toEqual(months);
  });

  test('asks nothing the screen already holds', async () => {
    const { result } = renderWithCache(() => ({
      bookings: useCalendarBookings(CLIENT, false, windowDays('2026-10-09', 7)),
      load: useCalendarPastLoader(CLIENT, false),
    }));
    await waitFor(() => expect(result.current.bookings.data).toBeDefined());
    await waitFor(() => expect(fetchCalendarBookings).toHaveBeenCalledTimes(3));

    await act(async () => {
      await result.current.load(CHUNK);
    });

    // September was read ahead and October is shown: no booking is asked again.
    expect(fetchCalendarBookings).toHaveBeenCalledTimes(3);
  });

  test('one read that fails fails the chunk', async () => {
    const failure = { message: 'canceling statement due to statement timeout' };
    fetchExpiredBetween.mockRejectedValue(failure);
    const { result } = renderWithCache(() => useCalendarPastLoader(CLIENT, false));

    let caught: unknown = null;
    await act(async () => {
      await result.current(CHUNK).catch((error: unknown) => {
        caught = error;
      });
    });

    expect(caught).toBe(failure);
  });
});
