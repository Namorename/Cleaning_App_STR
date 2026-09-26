import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * jsdom measures nothing, and a virtualizer that sees a zero-sized box draws
 * no rows at all (docs/f10-plan.md, §4). The window is given its size here.
 */
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

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

const row = (
  id: number,
  name: string,
  parent: number | null = null,
  unit: number | null = null,
) => ({
  id,
  name,
  parent_id: parent,
  hostaway_unit_id: unit,
  status: 'active',
  timezone: 'Europe/Prague',
});

const SMALL = [
  row(1, 'Anglicka 7'),
  row(10, 'Royal Cerna'),
  row(11, 'Unit 1', 10, 7001),
  row(12, 'Unit 2', 10, 7002),
  row(20, 'Villa Whole'),
  row(21, 'Villa East', 20),
  row(22, 'Villa West', 20),
];

const rowsState = {
  data: SMALL as ReturnType<typeof row>[] | undefined,
  isPending: false,
  isError: false,
};

vi.mock('../use-calendar', () => ({
  useCalendarClient: () => ({}),
  useCalendarRows: () => rowsState,
}));

import { CalendarView } from '../calendar-view';

const days = () =>
  screen
    .getAllByRole('columnheader')
    .slice(1)
    .map((cell) => cell.getAttribute('data-day'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-26T10:00:00Z'));
  window.localStorage.clear();
  rowsState.data = SMALL;
  rowsState.isPending = false;
  rowsState.isError = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the calendar', () => {
  test('says how many listings and rooms it holds', () => {
    render(<CalendarView />);

    expect(screen.getByText('Объектов: 5 · комнат: 2')).toBeInTheDocument();
  });

  test('opens on a week that starts the day before today', () => {
    render(<CalendarView />);

    expect(days()).toHaveLength(7);
    expect(days()[0]).toBe('2026-09-25');
  });

  test('marks today’s column', () => {
    render(<CalendarView />);

    const today = screen
      .getAllByRole('columnheader')
      .find((cell) => cell.getAttribute('data-day') === '2026-09-26');
    expect(today).toHaveAttribute('aria-current', 'date');
  });

  test('a depth changes the number of days, and is remembered', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: '30 дней' }));
    expect(days()).toHaveLength(30);

    unmount();
    render(<CalendarView />);
    expect(days()).toHaveLength(30);
  });

  test('the arrows step by the depth, and “Today” comes back', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: 'Следующий период' }));
    expect(days()[0]).toBe('2026-10-02');

    await user.click(screen.getByRole('button', { name: 'Предыдущий период' }));
    await user.click(screen.getByRole('button', { name: 'Предыдущий период' }));
    expect(days()[0]).toBe('2026-09-18');

    await user.click(screen.getByRole('button', { name: 'Сегодня' }));
    expect(days()[0]).toBe('2026-09-25');
  });
});

describe('rows', () => {
  test('rooms and parts hang under their listing, groups open', () => {
    render(<CalendarView />);

    const names = screen
      .getAllByRole('rowheader')
      .map((cell) => within(cell).getByTestId('row-name').textContent);
    expect(names).toEqual([
      'Anglicka 7',
      'Royal Cerna',
      'Unit 1',
      'Unit 2',
      'Villa Whole',
      'Villa East',
      'Villa West',
    ]);
  });

  test('a closed group stays closed after a reload', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: 'Скрыть единицы «Royal Cerna»' }));
    expect(screen.queryByText('Unit 1')).toBeNull();

    unmount();
    render(<CalendarView />);
    expect(screen.queryByText('Unit 1')).toBeNull();
    expect(screen.getByText('Villa East')).toBeInTheDocument();
  });

  // Virtualized from the start (§4): the DOM holds what fits, not every row.
  test('draws the rows that fit, not all of them', () => {
    rowsState.data = Array.from({ length: 150 }, (_, at) => row(1000 + at, `Listing ${at}`));
    render(<CalendarView />);

    expect(screen.getAllByRole('rowheader').length).toBeLessThan(150);
  });

  test('says when the listings could not be read, rather than drawing none', () => {
    rowsState.data = undefined;
    rowsState.isError = true;
    render(<CalendarView />);

    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить объекты');
    expect(screen.queryByRole('grid')).toBeNull();
  });
});
