import { fireEvent, render, screen, within } from '@testing-library/react';
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

const tasksState = {
  data: [] as CalendarTask[] | undefined,
  isPending: false,
  isError: false,
  error: null as unknown,
};

const ANNA = '11111111-1111-4111-8111-111111111111';
const IVA = '22222222-2222-4222-8222-222222222222';
const staffState = {
  data: [{ id: ANNA, full_name: 'Anna', role: 'cleaner' }],
  isPending: false,
  isError: false,
};

vi.mock('../use-calendar', () => ({
  useCalendarClient: () => ({}),
  useCalendarRows: () => rowsState,
  useCalendarBookings: () => bookingsState,
  useCalendarTasks: () => tasksState,
  useCalendarStaff: () => staffState,
}));

// What the calendar hands the form and the drawer is what is tested here;
// they have suites of their own.
vi.mock('@/features/tasks/task-form', () => ({
  TaskForm: (props: {
    task: { id: string } | null;
    initial?: { propertyId: number; scheduledDate: string };
  }) => (
    <div
      role="dialog"
      aria-label="Форма задания"
      data-task={props.task?.id ?? 'new'}
      data-property={props.initial?.propertyId ?? ''}
      data-day={props.initial?.scheduledDate ?? ''}
    />
  ),
}));
vi.mock('@/features/tasks/task-drawer', () => ({
  TaskDrawer: (props: { task: { id: string } }) => (
    <div role="dialog" aria-label="Шторка задания" data-task={props.task.id} />
  ),
}));

import { calendarTaskSchema, type CalendarTask } from '@/features/tasks/schema';

import { CalendarView } from '../calendar-view';
import type { CalendarBooking } from '../schema';

let taskSerial = 0;
const calendarTask = (
  property: number,
  day: string,
  extra: Record<string, unknown> = {},
): CalendarTask => {
  taskSerial += 1;
  return calendarTaskSchema.parse({
    id: `00000000-0000-4000-8000-${String(taskSerial).padStart(12, '0')}`,
    property_id: property,
    reservation_id: null,
    problem_id: null,
    type: 'cleaning',
    status: 'assigned',
    priority: 0,
    assignee_id: null,
    scheduled_date: day,
    time_from: null,
    time_to: null,
    started_at: null,
    completed_at: null,
    measured_minutes: null,
    duration_override_min: null,
    notes: null,
    created_at: '2026-09-20T08:00:00+00:00',
    property: { name: 'Anglicka 7' },
    assignee: null,
    problem: null,
    ...extra,
  });
};

const rowCell = (name: string) => {
  const row = screen
    .getAllByRole('row')
    .find((one) => one.querySelector('[role="rowheader"]')?.getAttribute('aria-label') === name);
  const cell = row?.querySelector('[role="gridcell"]');
  if (!cell) {
    throw new Error(`no row ${name}`);
  }
  return cell as HTMLElement;
};

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
  tasksState.data = [];
  tasksState.isPending = false;
  tasksState.isError = false;
  tasksState.error = null;
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

// The window of these tests: 25 September to 1 October 2026, a week of
// 130-px days after a 240-px column of listings.
describe('task chips', () => {
  test('a cleaning is a chip with who does it and when', () => {
    tasksState.data = [
      calendarTask(1, '2026-09-28', {
        assignee_id: ANNA,
        assignee: { full_name: 'Anna', role: 'cleaner' },
        time_from: '10:00:00',
        time_to: '15:00:00',
      }),
    ];
    render(<CalendarView />);

    const chip = screen.getByRole('button', { name: /Anna/ });
    expect(chip).toHaveAccessibleName(/Уборка/);
    expect(chip).toHaveAccessibleName(/10:00–15:00/);
  });

  test('a chip nobody holds says «Никто»', () => {
    tasksState.data = [calendarTask(1, '2026-09-28', { status: 'unassigned' })];
    render(<CalendarView />);

    expect(screen.getByRole('button', { name: /Никто/ })).toBeInTheDocument();
  });

  test('a cleaning before a same-day arrival is marked SDT', () => {
    tasksState.data = [calendarTask(1, '2026-09-28', { priority: 1 })];
    render(<CalendarView />);

    expect(screen.getByRole('button', { name: /Уборка/ })).toHaveAccessibleName(/SDT/);
  });

  test('an open chip opens the task form, a done one the drawer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const open = calendarTask(1, '2026-09-28', { status: 'accepted' });
    const done = calendarTask(1, '2026-09-26', { status: 'done' });
    tasksState.data = [open, done];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: /Принято/ }));
    expect(screen.getByRole('dialog', { name: 'Форма задания' })).toHaveAttribute(
      'data-task',
      open.id,
    );
  });

  test('a done chip opens the drawer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const done = calendarTask(1, '2026-09-26', { status: 'done' });
    tasksState.data = [done];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: /Выполнено/ }));
    expect(screen.getByRole('dialog', { name: 'Шторка задания' })).toHaveAttribute(
      'data-task',
      done.id,
    );
  });

  // The unit of work is the problem: its date and technician change there (§6).
  test('a repair chip leads to its problem', () => {
    const problem = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    tasksState.data = [
      calendarTask(1, '2026-09-28', {
        type: 'maintenance',
        problem_id: problem,
        problem: { title: 'Broken boiler', priority: 'high' },
      }),
    ];
    render(<CalendarView />);

    expect(screen.getByRole('link', { name: /Broken boiler/ })).toHaveAttribute(
      'href',
      `/problems/${problem}`,
    );
  });

  test('«Новое задание» opens an empty form', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: 'Новое задание' }));

    const form = screen.getByRole('dialog', { name: 'Форма задания' });
    expect(form).toHaveAttribute('data-task', 'new');
    expect(form).toHaveAttribute('data-property', '');
  });

  test('a click on an empty cell opens the form on that listing and that day', () => {
    render(<CalendarView />);

    // jsdom lays nothing out: the cell starts at 0, so the fourth day is at 3 × 130 px.
    fireEvent.click(rowCell('Anglicka 7'), { clientX: 3 * 130 + 5 });

    const form = screen.getByRole('dialog', { name: 'Форма задания' });
    expect(form).toHaveAttribute('data-property', '1');
    expect(form).toHaveAttribute('data-day', '2026-09-28');
  });

  test('the status filter keeps what it names', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    tasksState.data = [
      calendarTask(1, '2026-09-26', { status: 'done' }),
      calendarTask(1, '2026-09-28', { status: 'in_progress' }),
    ];
    render(<CalendarView />);

    await user.selectOptions(screen.getByLabelText('Статус'), 'Выполнено');

    expect(screen.getByRole('button', { name: /Выполнено/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /В работе/ })).toBeNull();
  });

  test('the assignee filter offers nobody, the staff, and a person who left, marked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    tasksState.data = [
      calendarTask(1, '2026-09-26', { status: 'unassigned' }),
      calendarTask(1, '2026-09-28', {
        assignee_id: IVA,
        assignee: { full_name: 'Iva', role: 'cleaner' },
      }),
    ];
    render(<CalendarView />);

    const field = screen.getByLabelText('Исполнитель');
    expect(within(field).getByRole('option', { name: 'Не назначено' })).toBeInTheDocument();
    expect(within(field).getByRole('option', { name: 'Anna' })).toBeInTheDocument();
    expect(within(field).getByRole('option', { name: 'Iva — нет доступа' })).toBeInTheDocument();

    await user.selectOptions(field, 'Не назначено');
    expect(screen.getByRole('button', { name: /Никто/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Iva/ })).toBeNull();
  });

  // Their chips are gone from this window; the filter must still say whom it holds.
  test('the assignee filter keeps a person who left after the window moves past their chips', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    tasksState.data = [
      calendarTask(1, '2026-09-28', {
        assignee_id: IVA,
        assignee: { full_name: 'Iva', role: 'cleaner' },
      }),
    ];
    const { rerender } = render(<CalendarView />);
    await user.selectOptions(screen.getByLabelText('Исполнитель'), 'Iva — нет доступа');

    tasksState.data = [
      calendarTask(1, '2026-09-30', {
        assignee_id: ANNA,
        assignee: { full_name: 'Anna', role: 'cleaner' },
      }),
    ];
    rerender(<CalendarView />);

    const field = screen.getByLabelText('Исполнитель') as HTMLSelectElement;
    expect(field.value).toBe(IVA);
    expect(within(field).getByRole('option', { name: 'Iva — нет доступа' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anna/ })).toBeNull();
  });

  test('a closed group’s chips say which room they stand on', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    tasksState.data = [
      calendarTask(11, '2026-09-28', { time_from: '10:00:00', property: { name: 'Unit 1' } }),
      calendarTask(12, '2026-09-28', { time_from: '12:00:00', property: { name: 'Unit 2' } }),
    ];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: 'Скрыть единицы «Royal Cerna»' }));

    expect(screen.getByRole('button', { name: /^Unit 1, / })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+1' }));
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^Unit 2, / }),
    ).toBeInTheDocument();
  });

  test('a person without a name reads «Без имени», not a blank', () => {
    tasksState.data = [
      calendarTask(1, '2026-09-28', {
        assignee_id: ANNA,
        assignee: { full_name: null, role: 'cleaner' },
      }),
    ];
    render(<CalendarView />);

    expect(screen.getByRole('button', { name: /Уборка/ })).toHaveAccessibleName(/Без имени/);
  });

  test('a cell with more than it has room for shows «+N», and «+N» lists them all', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    tasksState.data = [
      calendarTask(1, '2026-09-28', { time_from: '09:00:00' }),
      calendarTask(1, '2026-09-28', { time_from: '11:00:00', type: 'inspection' }),
      calendarTask(1, '2026-09-28', { time_from: '13:00:00', type: 'midstay' }),
    ];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: /\+2/ }));

    const list = screen.getByRole('dialog');
    expect(within(list).getAllByRole('button', { name: /Уборка|Осмотр|проживание/ })).toHaveLength(
      3,
    );
  });

  // §2: the generator leaves a taken or started cleaning where it was.
  test('a live chip whose booking is gone warns, once the bookings are read', () => {
    tasksState.data = [calendarTask(1, '2026-09-28', { status: 'accepted', reservation_id: 77 })];
    const { unmount } = render(<CalendarView />);

    expect(screen.getByRole('button', { name: /Принято/ })).toHaveAccessibleName(
      /Бронь изменилась/,
    );

    unmount();
    bookingsState.data = undefined;
    bookingsState.isPending = true;
    render(<CalendarView />);
    expect(screen.getByRole('button', { name: /Принято/ })).not.toHaveAccessibleName(
      /Бронь изменилась/,
    );
  });

  test('while the tasks load it says so; when they cannot be read it says that', () => {
    tasksState.data = undefined;
    tasksState.isPending = true;
    const { unmount } = render(<CalendarView />);
    expect(screen.getByText('Загружаем задания…')).toBeInTheDocument();

    unmount();
    tasksState.isPending = false;
    tasksState.isError = true;
    tasksState.error = { message: 'permission denied for table tasks' };
    render(<CalendarView />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить задания.');
    expect(alert).toHaveTextContent('permission denied for table tasks');
  });

  // Writing is off on the stand (§5): a chip shows what it would open.
  test('on the stand a chip opens a preview, not the form', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    tasksState.data = [calendarTask(1, '2026-09-28', { status: 'accepted' })];
    render(<CalendarView fixture />);

    await user.click(screen.getByRole('button', { name: /Принято/ }));

    expect(screen.queryByRole('dialog', { name: 'Форма задания' })).toBeNull();
    expect(screen.getByRole('dialog')).toHaveTextContent('Стенд: запись выключена');
  });
});
