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

const booking = (
  id: number,
  property: number,
  arrival: string,
  departure: string,
  extra: Partial<CalendarBooking> = {},
): CalendarBooking => ({
  id,
  property_id: property,
  arrival_date: arrival,
  departure_date: departure,
  status: 'new',
  is_block: false,
  guest_name: `Guest ${id}`,
  guests_count: 2,
  check_in_time: '15:00:00',
  check_out_time: '10:00:00',
  rooms: [],
  is_service_booking: false,
  ...extra,
});

const bookingsState = {
  data: [] as CalendarBooking[] | undefined,
  isPending: false,
  isError: false,
  error: null as unknown,
};

vi.mock('../use-calendar', () => ({
  useCalendarClient: () => ({}),
  useCalendarRows: () => rowsState,
  useCalendarBookings: () => bookingsState,
}));

import { CalendarView } from '../calendar-view';
import type { CalendarBooking } from '../schema';

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
  bookingsState.data = [];
  bookingsState.isPending = false;
  bookingsState.isError = false;
  bookingsState.error = null;
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

// The window of these tests: 25 September to 1 October 2026.
describe('bookings', () => {
  test('a stay is a bar with the guest, and opens a card that only reads', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    bookingsState.data = [
      booking(1, 1, '2026-09-26', '2026-09-28', { guest_name: 'Jan Novak', guests_count: 3 }),
    ];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: /Jan Novak/ }));

    const card = screen.getByRole('dialog');
    expect(card).toHaveTextContent('Jan Novak');
    expect(card).toHaveTextContent('Anglicka 7');
    expect(card).toHaveTextContent('3');
    expect(card).toHaveTextContent('15:00');
    expect(card).toHaveTextContent('10:00');
    expect(within(card).queryByRole('textbox')).toBeNull();
  });

  test('an owner stay and a "#" booking are blocks; the "#" name is only in the card', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    bookingsState.data = [
      booking(1, 1, '2026-09-25', '2026-09-26', { status: 'ownerStay', guest_name: null }),
      booking(2, 1, '2026-09-28', '2026-09-30', {
        guest_name: '#Boiler - repair',
        is_service_booking: true,
      }),
    ];
    render(<CalendarView />);

    const blocks = screen.getAllByRole('button', { name: /Блок \(не гость\)/ });
    expect(blocks).toHaveLength(2);
    expect(screen.queryByText('#Boiler - repair')).toBeNull();

    await user.click(blocks[1]);
    expect(screen.getByRole('dialog')).toHaveTextContent('#Boiler - repair');
  });

  test('a stay of two rooms is a bar on each, and pointing at one lights both', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    bookingsState.data = [
      booking(5, 10, '2026-09-26', '2026-09-28', {
        rooms: [{ property_id: 11 }, { property_id: 12 }],
      }),
    ];
    render(<CalendarView />);

    const bars = screen.getAllByRole('button', { name: /Guest 5/ });
    expect(bars).toHaveLength(2);

    await user.hover(bars[0]);
    expect(bars[0]).toHaveAttribute('data-highlighted', 'true');
    expect(bars[1]).toHaveAttribute('data-highlighted', 'true');
  });

  test('a double booking warns on both bars', () => {
    bookingsState.data = [
      booking(1, 1, '2026-09-25', '2026-09-28'),
      booking(2, 1, '2026-09-27', '2026-09-29'),
    ];
    render(<CalendarView />);

    expect(screen.getByRole('button', { name: /Guest 1/ })).toHaveAccessibleName(/Двойная бронь/);
    expect(screen.getByRole('button', { name: /Guest 2/ })).toHaveAccessibleName(/Двойная бронь/);
  });

  test('a stay longer than the window says it goes on at both ends', () => {
    bookingsState.data = [booking(9, 1, '2026-08-17', '2026-11-24')];
    render(<CalendarView />);

    const bar = screen.getByRole('button', { name: /Guest 9/ });
    expect(bar).toHaveAccessibleName(/Началась раньше/);
    expect(bar).toHaveAccessibleName(/Продолжается дальше/);
  });

  test('a closed group counts its taken rooms instead of drawing bars', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    bookingsState.data = [
      booking(5, 10, '2026-09-25', '2026-09-27', { rooms: [{ property_id: 11 }] }),
    ];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: 'Скрыть единицы «Royal Cerna»' }));

    expect(screen.getAllByText('1/2')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Guest 5/ })).toBeNull();
  });

  test('the whole villa let shades its parts', () => {
    bookingsState.data = [booking(7, 20, '2026-09-26', '2026-09-28')];
    render(<CalendarView />);

    expect(screen.getAllByTitle('Занято: вилла целиком')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Guest 7/ })).toHaveLength(1);
  });

  test('while the bookings load the grid says so and draws no bars', () => {
    bookingsState.data = undefined;
    bookingsState.isPending = true;
    render(<CalendarView />);

    expect(screen.getByText('Загружаем брони…')).toBeInTheDocument();
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  // An empty layer would read as "nothing is booked" (§1).
  test('when the bookings cannot be read it says so, with the server’s words under it', () => {
    bookingsState.data = undefined;
    bookingsState.isError = true;
    bookingsState.error = { message: 'canceling statement due to statement timeout' };
    render(<CalendarView />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить брони.');
    expect(alert).toHaveTextContent('canceling statement due to statement timeout');
  });
});
