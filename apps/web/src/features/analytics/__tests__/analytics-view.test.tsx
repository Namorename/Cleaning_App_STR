import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { i18n, languageFromCookie } from '@/lib/i18n';

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
  problems_cancelled: 1,
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
  problems_cancelled: 0,
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

const state: {
  current: Summary;
  previous: Summary;
  table: TableSlice<typeof ROW>;
  queries: AnalyticsQuery[];
} = {
  current: SUMMARY,
  previous: { ...SUMMARY, cleanings_done: 4 },
  table: { rows: [ROW], total: 1 },
  queries: [],
};

vi.mock('../use-analytics', () => ({
  useAnalyticsSummary: (query: AnalyticsQuery | null) => {
    if (query !== null) {
      state.queries.push(query);
    }
    return {
      data: query === null ? undefined : query.period.to < '2026-10-01' ? state.previous : state.current,
      isError: false,
      error: null,
    };
  },
  // Every listing, the archived ones too: the page counts them unless hidden.
  useAnalyticsListings: () => ({
    data: [
      { id: 1, name: 'Old Town flat', status: 'active' },
      { id: 2, name: 'Gone flat', status: 'archived' },
    ],
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
  state.queries = [];
  fetchWholeTable.mockClear();
  downloadCsv.mockClear();
});

describe('AnalyticsView in the panel’s own language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ru');
  });

  test('speaks the language the panel opens in without a choice: English', async () => {
    // What the panel's layout gives the page when no language was picked.
    await i18n.changeLanguage(languageFromCookie(undefined));
    render(<AnalyticsView />);
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
    const tiles = screen.getByRole('region', { name: 'Key figures' });
    expect(within(tiles).getByText('Cleanings done')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Hide archived' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  });

  test('gives the cancelled tasks a figure of their own, outside the others', async () => {
    await i18n.changeLanguage(languageFromCookie(undefined));
    render(<AnalyticsView />);
    const tiles = screen.getByRole('region', { name: 'Key figures' });
    const cancelled = within(tiles).getByText('Tasks cancelled').parentElement as HTMLElement;
    expect(within(cancelled).getByText('1')).toBeInTheDocument();
    expect(
      within(cancelled).getByText('by the day they were cancelled; not in the other figures'),
    ).toBeInTheDocument();
  });
});

describe('AnalyticsView and the archive', () => {
  test('offers an archived listing by its name, and the switch hides it from the page', () => {
    render(<AnalyticsView />);
    fireEvent.click(screen.getByText('Объекты', { selector: 'summary' }));
    expect(screen.getByRole('checkbox', { name: 'Gone flat (в архиве)' })).toBeInTheDocument();
    expect(state.queries.every((query) => !query.filters.hideArchived)).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Скрыть архивные' }));
    expect(new URLSearchParams(window.location.search).get('arch')).toBe('1');
    expect(state.queries.at(-1)?.filters.hideArchived).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'Gone flat (в архиве)' })).not.toBeInTheDocument();
  });

  test('a chip for an archived listing names it, hidden by the switch or not', () => {
    window.history.replaceState(null, '', '/analytics?p=thisMonth&prop=2');
    const { unmount } = render(<AnalyticsView />);
    expect(screen.getByRole('button', { name: 'Снять фильтр: Gone flat (в архиве)' })).toBeInTheDocument();
    unmount();

    window.history.replaceState(null, '', '/analytics?p=thisMonth&prop=2&arch=1');
    render(<AnalyticsView />);
    expect(screen.getByRole('button', { name: 'Снять фильтр: Gone flat (в архиве)' })).toBeInTheDocument();
  });

  test('somebody no longer on the team reads as a former employee, not as an id', () => {
    const gone = '33333333-3333-4333-8333-333333333333';
    window.history.replaceState(null, '', `/analytics?p=thisMonth&ppl=${gone}`);
    render(<AnalyticsView />);
    expect(screen.getByRole('button', { name: 'Снять фильтр: Бывший сотрудник' })).toBeInTheDocument();
    expect(screen.queryByText(gone)).not.toBeInTheDocument();
  });
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

  test('a period whose only tasks were cancelled is not empty', () => {
    state.current = { ...EMPTY, problems_cancelled: 2 };
    render(<AnalyticsView />);
    expect(screen.queryByText('За этот период считать нечего')).not.toBeInTheDocument();
    const tiles = screen.getByRole('region', { name: 'Ключевые показатели' });
    const cancelled = within(tiles).getByText('Заданий отменено').parentElement as HTMLElement;
    expect(within(cancelled).getByText('2')).toBeInTheDocument();
    expect(within(cancelled).getByText('по дню отмены; в другие цифры не входят')).toBeInTheDocument();
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
