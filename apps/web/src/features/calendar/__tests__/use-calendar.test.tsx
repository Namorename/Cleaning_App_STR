import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

const fetchCalendarBookings = vi.fn();
vi.mock('../api', () => ({
  fetchCalendarBookings: (...args: unknown[]) => fetchCalendarBookings(...args),
}));

import { windowDays } from '../dates';
import type { CalendarBooking } from '../schema';
import { useCalendarBookings } from '../use-calendar';

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

// 28 September to 4 October: two months.
const DAYS = windowDays('2026-09-28', 7);

beforeEach(() => {
  fetchCalendarBookings.mockReset();
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
});
