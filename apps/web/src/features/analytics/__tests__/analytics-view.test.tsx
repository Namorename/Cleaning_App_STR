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

const EVA = '44444444-4444-4444-8444-444444444444';

const LISTINGS = [
  { id: 1, name: 'Old Town flat', status: 'active' },
  { id: 2, name: 'Gone flat', status: 'archived' },
];

function cleanerRow(id: string, fullName: string, done: number) {
  return {
    person_id: id,
    full_name: fullName,
    done,
    done_midstay: 0,
    planned: done,
    minutes_median: 45,
    minutes_avg: 45,
    photo_share: 0.5,
    listings: 1,
    total_count: 1,
  };
}

const state: {
  current: Summary;
  previous: Summary;
  table: TableSlice<typeof ROW>;
  queries: AnalyticsQuery[];
  tableQueries: { table: string; query: AnalyticsQuery }[];
  staff: { data: unknown; isError: boolean; error: unknown; isFetching: boolean; refetch: () => void };
  listings: { data: unknown; isError: boolean; error: unknown; isFetching: boolean; refetch: () => void };
  /** The picked ones' own rows cannot be read. */
  picksFail: boolean;
} = {
  current: SUMMARY,
  previous: { ...SUMMARY, cleanings_done: 4 },
  table: { rows: [ROW], total: 1 },
  queries: [],
  tableQueries: [],
  staff: { data: [], isError: false, error: null, isFetching: false, refetch: () => {} },
  listings: { data: LISTINGS, isError: false, error: null, isFetching: false, refetch: () => {} },
  picksFail: false,
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
  useAnalyticsListings: () => state.listings,
  // The busiest cleaners are read without the people filter; the picked
  // ones, with it.
  useAnalyticsTable: (table: string, query: AnalyticsQuery | null) => {
    if (query === null) {
      return { data: undefined, isError: false, error: null };
    }
    state.tableQueries.push({ table, query });
    const isPickRead =
      (table === 'cleaningsByCleaner' && query.filters.personIds.length > 0) ||
      (table === 'cleaningsByProperty' && query.filters.propertyIds.includes(2));
    if (isPickRead && state.picksFail) {
      return { data: undefined, isError: true, error: new Error('picks failed') };
    }
    if (table === 'cleaningsByProperty' && isPickRead) {
      const gone = { ...ROW, listing_id: 2, listing_name: 'Gone flat', done: 1 };
      return { data: { rows: [gone], total: 1 }, isError: false, error: null };
    }
    if (table !== 'cleaningsByCleaner') {
      return { data: state.table, isError: false, error: null };
    }
    const rows = isPickRead
      ? [cleanerRow(EVA, 'Eva Dvořák', 1)]
      : [cleanerRow('11111111-1111-4111-8111-111111111111', 'Anna Novak', 3)];
    return { data: { rows, total: rows.length }, isError: false, error: null };
  },
  useAnalyticsSeries: () => ({ data: SERIES, isError: false, error: null }),
}));

vi.mock('@/features/tasks/use-tasks', () => ({
  useProperties: () => ({
    data: [{ id: 1, name: 'Old Town flat', parent_id: null, hostaway_unit_id: null, status: 'active', timezone: 'Europe/Prague' }],
  }),
  useStaff: () => state.staff,
}));

const fetchWholeTable = vi.fn(async () => [ROW]);
vi.mock('../api', () => ({ fetchWholeTable: (...args: unknown[]) => fetchWholeTable(...(args as [])) }));

const downloadCsv = vi.fn();
vi.mock('@/lib/export-table', () => ({
  downloadCsv: (...args: unknown[]) => downloadCsv(...args),
  downloadXlsx: vi.fn(),
}));

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

const downloadAnalyticsPdf = vi.fn(async (request: { fileName: string }) => {
  void request;
});
vi.mock('../pdf/download', () => ({
  downloadAnalyticsPdf: (request: { fileName: string }) => downloadAnalyticsPdf(request),
}));

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
  state.tableQueries = [];
  state.staff = { data: [], isError: false, error: null, isFetching: false, refetch: () => {} };
  state.listings = { data: LISTINGS, isError: false, error: null, isFetching: false, refetch: () => {} };
  state.picksFail = false;
  fetchWholeTable.mockClear();
  downloadCsv.mockClear();
  downloadAnalyticsPdf.mockClear();
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
    expect(fileName).toBe('woom-analytics_cleanings-by-property_2026-10-01_to_2026-10-31.csv');
    expect(rows[1]).toEqual(['Old Town flat', 4, 3, 1, 1, 0, 45, 50]);
  });

  test('a table file filtered to a listing says so in Latin letters, whatever the page language', async () => {
    window.history.replaceState(null, '', '/analytics?p=thisMonth&prop=2');
    render(<AnalyticsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV' }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
    expect(downloadCsv.mock.calls[0][0]).toBe(
      'woom-analytics_cleanings-by-property_2026-10-01_to_2026-10-31_property-gone-flat.csv',
    );
  });

  test('the PDF is asked for under the report’s own file name', async () => {
    window.history.replaceState(null, '', `/analytics?p=thisMonth&prop=1&ppl=${EVA}`);
    render(<AnalyticsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Скачать PDF' }));
    await waitFor(() => expect(downloadAnalyticsPdf).toHaveBeenCalledTimes(1));
    expect(downloadAnalyticsPdf.mock.calls[0][0].fileName).toBe(
      'woom-analytics-report_2026-10-01_to_2026-10-31_property-old-town-flat_person-44444444.pdf',
    );
  });

  test('a click on a listing bar filters the whole page to it, and a chip lets it go', () => {
    render(<AnalyticsView />);
    fireEvent.click(screen.getByRole('button', { name: /^Old Town flat\s*3$/ }));
    expect(new URLSearchParams(window.location.search).get('prop')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Снять фильтр: Old Town flat' }));
    expect(new URLSearchParams(window.location.search).get('prop')).toBeNull();
  });

  test('a cleaner picked outside the busiest bars gets her own bar, pressed; the rest quieter', () => {
    window.history.replaceState(null, '', `/analytics?p=thisMonth&ppl=${EVA}`);
    render(<AnalyticsView />);
    const eva = screen.getByRole('button', { name: /^Eva Dvořák\s*1$/ });
    expect(eva).toHaveAttribute('aria-pressed', 'true');
    const anna = screen.getByRole('button', { name: /^Anna Novak\s*3$/ });
    expect(anna).toHaveAttribute('aria-pressed', 'false');
    expect(anna).toHaveClass('opacity-60');
    // Her row is read with the filter, through the page's own table function.
    expect(
      state.tableQueries.some(
        ({ table, query }) => table === 'cleaningsByCleaner' && query.filters.personIds.includes(EVA),
      ),
    ).toBe(true);
  });

  test('a listing picked outside the busiest bars gets its own bar, pressed', () => {
    window.history.replaceState(null, '', '/analytics?p=thisMonth&prop=2');
    render(<AnalyticsView />);
    expect(screen.getByRole('button', { name: /^Gone flat\s*1$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Old Town flat\s*3$/ })).toHaveClass('opacity-60');
  });

  test('picks whose own rows did not load: the busiest bars stay, the failure said under them', () => {
    state.picksFail = true;
    window.history.replaceState(null, '', `/analytics?p=thisMonth&ppl=${EVA}`);
    render(<AnalyticsView />);
    const list = screen.getByRole('region', { name: 'Выполненные уборки по горничным' });
    expect(within(list).getByRole('button', { name: /^Anna Novak\s*3$/ })).toBeInTheDocument();
    expect(within(list).getByRole('alert')).toHaveTextContent('Не удалось загрузить таблицу');
  });

  test('listings and team both unloaded: one press loads both again', () => {
    const listingsAgain = vi.fn();
    const teamAgain = vi.fn();
    const failed = { data: undefined, isError: true, error: new Error('Failed to fetch'), isFetching: false };
    state.listings = { ...failed, refetch: listingsAgain };
    state.staff = { ...failed, refetch: teamAgain };
    render(<AnalyticsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(listingsAgain).toHaveBeenCalledTimes(1);
    expect(teamAgain).toHaveBeenCalledTimes(1);
  });

  test('while a failed team is asked again, the reason and the busy press stay', () => {
    // TanStack clears the error while it asks again: pending, fetching, one failure behind it.
    state.staff = {
      data: undefined,
      isError: false,
      error: null,
      isFetching: true,
      errorUpdateCount: 1,
      refetch: vi.fn(),
    } as typeof state.staff;
    render(<AnalyticsView />);
    expect(screen.getByText('Для отчёта нужны объекты и сотрудники, а они не загрузились.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузка…' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('a failed team asked again while offline still says why', () => {
    // No network: TanStack pauses the retry — neither an error nor fetching.
    state.staff = {
      data: undefined,
      isError: false,
      error: null,
      isFetching: false,
      isPaused: true,
      errorUpdateCount: 1,
      refetch: vi.fn(),
    } as typeof state.staff;
    render(<AnalyticsView />);
    expect(screen.getByText('Для отчёта нужны объекты и сотрудники, а они не загрузились.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузка…' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('a team still on its first load is no failure', () => {
    state.staff = {
      data: undefined,
      isError: false,
      error: null,
      isFetching: true,
      errorUpdateCount: 0,
      refetch: vi.fn(),
    } as typeof state.staff;
    render(<AnalyticsView />);
    expect(screen.queryByText('Для отчёта нужны объекты и сотрудники, а они не загрузились.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скачать PDF' })).toBeDisabled();
  });

  test('a team that did not load: the PDF button says why and loads it again', () => {
    const refetch = vi.fn();
    state.staff = { data: undefined, isError: true, error: new Error('Failed to fetch'), isFetching: false, refetch };
    render(<AnalyticsView />);
    expect(screen.getByRole('button', { name: 'Скачать PDF' })).toBeDisabled();
    expect(screen.getByText('Для отчёта нужны объекты и сотрудники, а они не загрузились.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(refetch).toHaveBeenCalledTimes(1);
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
