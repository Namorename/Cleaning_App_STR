import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { AnalyticsQuery, Summary, TableSlice } from '../schema';

const SUMMARY: Summary = {
  cleanings_done: 5,
  cleanings_done_midstay: 1,
  cleanings_planned: 6,
  cleanings_planned_midstay: 1,
  cleaning_minutes_median: 75,
  cleaning_minutes_avg: 80,
  cleanings_with_photo: 1,
  photo_share: 0.2,
  checkouts: 3,
  rooms_released: 2,
  occupied_nights: 6,
  available_nights: 40,
  occupancy: 0.15,
  problems_created: 3,
  problems_resolved: 2,
  problems_open: 2,
  urgency_avg: 2,
  problems_by_priority: { low: 1, normal: 1, high: 1 },
};

const SERIES = [
  { bucket: '2026-10-01', cleanings_done: 2, cleanings_planned: 2, checkouts: 1, problems_created: 0, problems_resolved: 0 },
  { bucket: '2026-10-02', cleanings_done: 3, cleanings_planned: 3, checkouts: 2, problems_created: 1, problems_resolved: 0 },
];

const EMPTY: Summary = {
  ...SUMMARY,
  cleanings_done: 0,
  cleanings_done_midstay: 0,
  cleanings_planned: 0,
  cleanings_planned_midstay: 0,
  cleaning_minutes_median: null,
  cleaning_minutes_avg: null,
  cleanings_with_photo: 0,
  photo_share: null,
  checkouts: 0,
  rooms_released: 0,
  occupied_nights: 0,
  occupancy: 0,
  problems_created: 0,
  problems_resolved: 0,
  problems_open: 0,
  urgency_avg: null,
};

const ROW = {
  listing_id: 1,
  listing_name: 'Old Town flat',
  planned: 4,
  done: 3,
  done_midstay: 1,
  expired: 1,
  cancelled: 0,
  minutes_median: 45,
  minutes_avg: 45,
  photo_share: 0.5,
  total_count: 1,
};

const state: { current: Summary; previous: Summary; table: TableSlice<typeof ROW> } = {
  current: SUMMARY,
  previous: { ...SUMMARY, cleanings_done: 4 },
  table: { rows: [ROW], total: 1 },
};

vi.mock('../use-analytics', () => ({
  useAnalyticsSummary: (query: AnalyticsQuery | null) => ({
    data: query === null ? undefined : query.period.to < '2026-10-01' ? state.previous : state.current,
    isError: false,
    error: null,
  }),
  useAnalyticsTable: (table: string) => ({
    data:
      table === 'cleaningsByCleaner'
        ? {
            rows: [
              {
                person_id: '11111111-1111-4111-8111-111111111111',
                full_name: 'Anna Novak',
                done: 3,
                done_midstay: 0,
                planned: 3,
                minutes_median: 45,
                minutes_avg: 45,
                photo_share: 0.5,
                listings: 1,
                total_count: 1,
              },
            ],
            total: 1,
          }
        : state.table,
    isError: false,
    error: null,
  }),
  useAnalyticsSeries: () => ({ data: SERIES, isError: false, error: null }),
}));

vi.mock('@/features/tasks/use-tasks', () => ({
  useProperties: () => ({
    data: [{ id: 1, name: 'Old Town flat', parent_id: null, hostaway_unit_id: null, status: 'active', timezone: 'Europe/Prague' }],
  }),
  useStaff: () => ({ data: [] }),
}));

const fetchWholeTable = vi.fn(async () => [ROW]);
vi.mock('../api', () => ({ fetchWholeTable: (...args: unknown[]) => fetchWholeTable(...(args as [])) }));

const downloadCsv = vi.fn();
vi.mock('@/lib/export-table', () => ({
  downloadCsv: (...args: unknown[]) => downloadCsv(...args),
  downloadXlsx: vi.fn(),
}));

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// The whole of October, compared with the whole of September.
vi.mock('@/lib/format-date', async (original) => ({
  ...(await original<typeof import('@/lib/format-date')>()),
  todayIn: () => '2026-10-31',
}));

import { AnalyticsView } from '../analytics-view';

beforeEach(() => {
  window.history.replaceState(null, '', '/analytics?p=thisMonth');
  state.current = SUMMARY;
  state.table = { rows: [ROW], total: 1 };
  fetchWholeTable.mockClear();
  downloadCsv.mockClear();
});

describe('AnalyticsView', () => {
  test('shows the key figures with their change against the period before', () => {
    render(<AnalyticsView />);
    const tiles = screen.getByRole('region', { name: 'Ключевые показатели' });
    const done = within(tiles).getByText('Уборок выполнено').parentElement as HTMLElement;
    expect(within(done).getByText('5')).toBeInTheDocument();
    // ru-RU writes a no-break space before the per cent sign.
    expect(
      within(done).getByText(/^Изменение к предыдущему периоду: \+25\s%$/),
    ).toHaveClass('sr-only');
    expect(within(tiles).getByText('75 мин')).toBeInTheDocument();
  });

  test('says there is nothing to count when the period is empty', () => {
    state.current = EMPTY;
    render(<AnalyticsView />);
    expect(screen.getByText('За этот период считать нечего')).toBeInTheDocument();
  });

  test('downloads the whole table, not only the page on the screen', async () => {
    render(<AnalyticsView />);
    expect(screen.getByRole('rowheader', { name: 'Old Town flat' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV' }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
    expect(fetchWholeTable).toHaveBeenCalledTimes(1);
    const [fileName, rows] = downloadCsv.mock.calls[0] as [string, unknown[][]];
    expect(fileName).toBe('analytics-cleanings-by-property-2026-10-01_2026-10-31.csv');
    expect(rows[1]).toEqual(['Old Town flat', 4, 3, 1, 1, 0, 45, 50]);
  });

  test('a click on a listing bar filters the whole page to it, and a chip lets it go', () => {
    render(<AnalyticsView />);
    fireEvent.click(screen.getByRole('button', { name: /^Old Town flat\s*3$/ }));
    expect(new URLSearchParams(window.location.search).get('prop')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Снять фильтр: Old Town flat' }));
    expect(new URLSearchParams(window.location.search).get('prop')).toBeNull();
  });

  test('a click on a day narrows the period to that day', () => {
    render(<AnalyticsView />);
    fireEvent.click(screen.getAllByRole('button', { name: /Показать только этот день/ })[0]);
    const params = new URLSearchParams(window.location.search);
    expect([params.get('from'), params.get('to')]).toEqual(['2026-10-01', '2026-10-01']);
  });

  test('offers the demo listings only on the local stand', () => {
    render(<AnalyticsView />);
    expect(screen.queryByText('С демо-объектами (локальный стенд)')).not.toBeInTheDocument();
  });
});
