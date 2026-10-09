import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * What the calendar asks the database for (docs/f10-plan.md, §1), read through
 * its real layers: only the readers are stubbed, and every call is recorded.
 * The default open is pinned here — the past on demand (block 7, 2026-10-10)
 * must not add a single request to it.
 */

// jsdom measures nothing; the virtualizer is told the window's size.
vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-virtual')>();
  const rect = { width: 1280, height: 720 };
  return {
    ...actual,
    useVirtualizer: (options: Parameters<typeof actual.useVirtualizer>[0]) =>
      actual.useVirtualizer({
        ...options,
        initialRect: rect,
        observeElementRect: (_instance, onChange) => {
          onChange(rect);
          return () => {};
        },
      }),
  };
});

// One client for the page's life, as the panel's own hook hands out.
const CLIENT = vi.hoisted(() => ({}));
vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => CLIENT }));

const reads = vi.hoisted(() => ({
  properties: vi.fn(),
  staff: vi.fn(),
  tasks: vi.fn(),
  expired: vi.fn(),
  repairs: vi.fn(),
  bookings: vi.fn(),
}));

vi.mock('@/features/tasks/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tasks/api')>()),
  fetchProperties: (...args: unknown[]) => reads.properties(...args),
  fetchStaff: (...args: unknown[]) => reads.staff(...args),
  fetchTasksBetween: (...args: unknown[]) => reads.tasks(...args),
  fetchExpiredBetween: (...args: unknown[]) => reads.expired(...args),
  fetchLiveRepairs: (...args: unknown[]) => reads.repairs(...args),
}));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  fetchCalendarBookings: (...args: unknown[]) => reads.bookings(...args),
}));

vi.mock('@/features/tasks/use-tasks', () => ({
  useTask: () => ({ data: undefined, isPending: true, isError: false, error: null }),
}));
vi.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set<string>(), problems: new Set<string>() }),
}));

import { CalendarView } from '../calendar-view';

const LISTING = {
  id: 1,
  name: 'Anglicka 7',
  parent_id: null,
  hostaway_unit_id: null,
  status: 'active',
  timezone: 'Europe/Prague',
};

/** A reader's calls as `from..to` (and the class, for tasks), sorted. */
const ranges = (mock: ReturnType<typeof vi.fn>, taskClass?: string) =>
  mock.mock.calls
    .filter((call) => taskClass === undefined || call[3] === taskClass)
    .map((call) => `${String(call[1])}..${String(call[2])}`)
    .sort();

function renderCalendar() {
  // The panel's own defaults (app/providers.tsx), retries aside.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CalendarView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Today is 10 October 2026: the window is 9–15 October.
  vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
  window.localStorage.clear();
  reads.properties.mockResolvedValue([LISTING]);
  reads.staff.mockResolvedValue([]);
  reads.tasks.mockResolvedValue([]);
  reads.expired.mockResolvedValue([]);
  reads.repairs.mockResolvedValue([]);
  reads.bookings.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  for (const mock of Object.values(reads)) {
    mock.mockReset();
  }
});

describe('the default open', () => {
  test('asks for the window’s month, the months on either side ahead, and nothing more', async () => {
    renderCalendar();

    await screen.findByRole('grid');
    await waitFor(() => expect(reads.bookings).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(reads.tasks).toHaveBeenCalledTimes(3));
    // Whatever the open would still ask, it has asked by now.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(reads.properties).toHaveBeenCalledTimes(1);
    expect(reads.staff).toHaveBeenCalledTimes(1);
    expect(reads.repairs).toHaveBeenCalledTimes(1);
    expect(ranges(reads.bookings)).toEqual([
      '2026-09-01..2026-10-01',
      '2026-10-01..2026-11-01',
      '2026-11-01..2026-12-01',
    ]);
    expect(ranges(reads.tasks, 'active')).toEqual([
      '2026-09-01..2026-10-01',
      '2026-10-01..2026-11-01',
      '2026-11-01..2026-12-01',
    ]);
    // What never happened: the visible month only; the cancelled: not at all.
    expect(ranges(reads.expired)).toEqual(['2026-10-01..2026-11-01']);
    expect(ranges(reads.tasks, 'cancelled')).toEqual([]);
    expect(reads.tasks).toHaveBeenCalledTimes(3);
  });

  // Block 7: a chunk of the past asks for what the screen does not hold yet,
  // and nothing ahead of it.
  test('«Показать прошлое» asks only for the months of the chunk the screen does not hold', async () => {
    renderCalendar();
    await screen.findByRole('grid');
    await waitFor(() => expect(reads.tasks).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const mock of Object.values(reads)) {
      mock.mockClear();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Показать прошлое' }));

    // 25 September to 8 October: September is new to what never happened and
    // to the cancelled; October is new to the cancelled only.
    await waitFor(() =>
      expect(screen.getAllByRole('columnheader')[1]).toHaveAttribute('data-day', '2026-09-25'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ranges(reads.expired)).toEqual(['2026-09-01..2026-10-01']);
    expect(ranges(reads.tasks, 'cancelled')).toEqual([
      '2026-09-01..2026-10-01',
      '2026-10-01..2026-11-01',
    ]);
    expect(ranges(reads.tasks, 'active')).toEqual([]);
    expect(ranges(reads.bookings)).toEqual([]);
    expect(reads.properties).not.toHaveBeenCalled();
  });

  test('draws the week from the day before today', async () => {
    renderCalendar();

    await screen.findByRole('grid');
    const days = screen
      .getAllByRole('columnheader')
      .slice(1)
      .map((cell) => cell.getAttribute('data-day'));
    expect(days).toEqual([
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ]);
  });
});
