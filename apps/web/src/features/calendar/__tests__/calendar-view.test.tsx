import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const expiredState = {
  data: [] as ExpiredTask[] | undefined,
  isPending: false,
  isError: false,
  error: null as unknown,
};
const cancelledState = {
  data: [] as CalendarTask[] | undefined,
  isPending: false,
  isError: false,
  error: null as unknown,
};
const repairsState = {
  data: [] as LiveRepair[] | undefined,
  isPending: false,
  isError: false,
  error: null as unknown,
};

// The past is read before it is shown (block 7); here the reading is a promise
// the test settles by hand. What it reads has a suite of its own.
const pastLoad = vi.fn<(days: readonly string[]) => Promise<void>>();

vi.mock('../use-calendar', () => ({
  useCalendarClient: () => ({}),
  useCalendarRows: () => rowsState,
  useCalendarBookings: () => bookingsState,
  useCalendarTasks: () => tasksState,
  useCalendarStaff: () => staffState,
  useCalendarExpired: () => expiredState,
  useCalendarCancelled: () => cancelledState,
  useLiveRepairs: () => repairsState,
  useCalendarPastLoader: () => pastLoad,
}));

// A mark of what never happened is read narrow; its drawer reads it whole.
const wholeTask = vi.fn((id: string | null) => ({
  data: id === null ? undefined : calendarTask(1, '2026-09-25', { id, status: 'expired' }),
  isPending: false,
  isError: false,
  error: null,
}));
vi.mock('@/features/tasks/use-tasks', () => ({
  useTask: (id: string | null) => wholeTask(id),
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
      aria-label="Форма уборки"
      data-task={props.task?.id ?? 'new'}
      data-property={props.initial?.propertyId ?? ''}
      data-day={props.initial?.scheduledDate ?? ''}
    />
  ),
}));
vi.mock('@/features/tasks/task-drawer', () => ({
  TaskDrawer: (props: { task: { id: string }; onOpenChat: (task: { id: string }) => void }) => (
    <div role="dialog" aria-label="Шторка уборки" data-task={props.task.id}>
      <button type="button" onClick={() => props.onOpenChat(props.task)}>
        Чат
      </button>
    </div>
  ),
}));
vi.mock('@/features/chat/chat-sheet', () => ({
  ChatSheet: (props: {
    subject: Record<string, string>;
    about: string;
    returnFocus?: () => HTMLElement | null;
  }) => (
    <div role="dialog" aria-label="Чат">
      {`${Object.values(props.subject).join(',')} · ${props.about}`}
      {/* Where the real sheet sends the focus when it closes. */}
      <button type="button" onClick={() => props.returnFocus?.()?.focus()}>
        Вернуть фокус
      </button>
    </div>
  ),
}));

// The marks come from one company-wide answer; here it is a pair of sets the
// test fills by hand.
const unread = { tasks: new Set<string>(), problems: new Set<string>() };
vi.mock('@/features/chat/use-chat', () => ({ useUnreadSubjects: () => unread }));

import {
  calendarTaskSchema,
  liveRepairSchema,
  type CalendarTask,
  type ExpiredTask,
  type LiveRepair,
} from '@/features/tasks/schema';

import { expectPageTitle } from '@/components/page-header.expect';

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
  expiredState.data = [];
  cancelledState.data = [];
  repairsState.data = [];
  unread.tasks.clear();
  unread.problems.clear();
  pastLoad.mockReset();
  pastLoad.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the calendar', () => {
  test('is headed by the common header, its counts beside the title', () => {
    render(<CalendarView />);

    expectPageTitle('Календарь');
    expect(screen.getByRole('heading', { level: 1 }).parentElement).toContainElement(
      screen.getByText('Объектов: 5 · комнат: 2'),
    );
  });

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

  // The owner's request of 2026-09-27: at 15 days a third of the screen stood
  // empty. The days fill the area; narrower than the least width, it scrolls.
  test('the days stretch to fill the width of the area', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly onResize: ResizeObserverCallback) {}
        observe(target: Element) {
          this.onResize([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      window.localStorage.setItem('str-ops.calendar.depth', '15');
      render(<CalendarView />);

      // (1280 − the 240 px of listings) / 15 days, rounded down.
      await waitFor(() =>
        expect(screen.getAllByRole('columnheader')[1]).toHaveStyle({ width: '69px' }),
      );
    } finally {
      width.mockRestore();
      vi.unstubAllGlobals();
    }
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

  // 7.6 measures «overscan = count» too; only the stand listens to the address.
  test('on the stand, ?overscan=all draws every row; elsewhere the address is ignored', () => {
    rowsState.data = Array.from({ length: 150 }, (_, at) => row(1000 + at, `Listing ${at}`));
    window.history.replaceState(null, '', '/calendar?overscan=all');
    try {
      const { unmount } = render(<CalendarView />);
      expect(screen.getAllByRole('rowheader').length).toBeLessThan(150);
      unmount();

      render(<CalendarView fixture />);
      expect(screen.getAllByRole('rowheader')).toHaveLength(150);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  test('on the stand, the first full drawing leaves a mark to measure by', async () => {
    performance.clearMarks('calendar:painted');
    const { unmount } = render(<CalendarView />);
    await new Promise((done) => setTimeout(done, 50));
    expect(performance.getEntriesByName('calendar:painted')).toHaveLength(0);
    unmount();

    render(<CalendarView fixture />);

    await waitFor(() => expect(performance.getEntriesByName('calendar:painted')).toHaveLength(1));
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

    await user.click(screen.getByRole('button', { name: /Принята/ }));
    expect(screen.getByRole('dialog', { name: 'Форма уборки' })).toHaveAttribute(
      'data-task',
      open.id,
    );
  });

  test('a done chip opens the drawer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const done = calendarTask(1, '2026-09-26', { status: 'done' });
    tasksState.data = [done];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: /Выполнена/ }));
    expect(screen.getByRole('dialog', { name: 'Шторка уборки' })).toHaveAttribute(
      'data-task',
      done.id,
    );
  });

  // 5.4, «Чат»: the drawer's «Чат» swaps it for the conversation's sheet.
  test('the drawer’s «Чат» puts it away and opens the job’s conversation', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const done = calendarTask(1, '2026-09-26', { status: 'done' });
    tasksState.data = [done];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: /Выполнена/ }));
    await user.click(screen.getByRole('button', { name: 'Чат' }));

    expect(screen.getByRole('dialog', { name: 'Чат' })).toHaveTextContent(
      `${done.id} · Уборка · Anglicka 7`,
    );
    expect(screen.queryByRole('dialog', { name: 'Шторка уборки' })).toBeNull();
  });

  // The review of 05.10: the drawer that led to the conversation is gone when
  // it closes; the focus goes back to the chip, not to the page's body.
  test('the conversation hands the focus back to the chip it came from', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    tasksState.data = [calendarTask(1, '2026-09-26', { status: 'done' })];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: /Выполнена/ }));
    await user.click(screen.getByRole('button', { name: 'Чат' }));
    await user.click(screen.getByRole('button', { name: 'Вернуть фокус' }));

    expect(screen.getByRole('button', { name: /Выполнена/ })).toHaveFocus();
  });

  test('a chip somebody wrote about says so in its name', () => {
    const written = calendarTask(1, '2026-09-26');
    const quiet = calendarTask(1, '2026-09-27');
    tasksState.data = [written, quiet];
    unread.tasks.add(written.id);
    render(<CalendarView />);

    expect(screen.getAllByRole('button', { name: /Новое сообщение/ })).toHaveLength(1);
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

  test('«Новая уборка» opens an empty form', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: 'Новая уборка' }));

    const form = screen.getByRole('dialog', { name: 'Форма уборки' });
    expect(form).toHaveAttribute('data-task', 'new');
    expect(form).toHaveAttribute('data-property', '');
  });

  test('a click on an empty cell opens the form on that listing and that day', () => {
    render(<CalendarView />);

    // jsdom lays nothing out: the cell starts at 0, so the fourth day is at 3 × 130 px.
    fireEvent.click(rowCell('Anglicka 7'), { clientX: 3 * 130 + 5 });

    const form = screen.getByRole('dialog', { name: 'Форма уборки' });
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

    await user.selectOptions(screen.getByLabelText('Статус'), 'Выполнена');

    expect(screen.getByRole('button', { name: /Выполнена/ })).toBeInTheDocument();
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

  // The dashboard's «Без исполнителя» opens /calendar?assignee=nobody (the page reads the address).
  test('opens on the chips nobody holds when the address asks for them', () => {
    tasksState.data = [
      calendarTask(1, '2026-09-26', { status: 'unassigned' }),
      calendarTask(1, '2026-09-28', {
        assignee_id: ANNA,
        assignee: { full_name: 'Anna', role: 'cleaner' },
      }),
    ];
    render(<CalendarView initialAssignee="nobody" />);

    expect((screen.getByLabelText('Исполнитель') as HTMLSelectElement).value).toBe('nobody');
    expect(screen.getByRole('button', { name: /Никто/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anna/ })).toBeNull();
  });

  // The tile counts today and the six days on; the calendar it opens shows them
  // all, whatever depth was kept, and keeps that depth for the next visit.
  test('opened for the week ahead, starts on today at a week, and remembers nothing of it', () => {
    window.localStorage.setItem('str-ops.calendar.depth', '3');

    render(<CalendarView initialAssignee="nobody" openAheadDays={7} />);

    expect(days()).toHaveLength(7);
    expect(days()[0]).toBe('2026-09-26');
    expect(window.localStorage.getItem('str-ops.calendar.depth')).toBe('3');
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

  // §2: the generator leaves a started cleaning where it was (20260926160000).
  test('a live chip whose booking is gone warns, once the bookings are read', () => {
    tasksState.data = [calendarTask(1, '2026-09-28', { status: 'paused', reservation_id: 77 })];
    const { unmount } = render(<CalendarView />);

    expect(screen.getByRole('button', { name: /Пауза/ })).toHaveAccessibleName(/Бронь изменилась/);

    unmount();
    bookingsState.data = undefined;
    bookingsState.isPending = true;
    render(<CalendarView />);
    expect(screen.getByRole('button', { name: /Пауза/ })).not.toHaveAccessibleName(
      /Бронь изменилась/,
    );
  });

  test('while the tasks load it says so; when they cannot be read it says that', () => {
    tasksState.data = undefined;
    tasksState.isPending = true;
    const { unmount } = render(<CalendarView />);
    expect(screen.getByText('Загружаем уборки…')).toBeInTheDocument();

    unmount();
    tasksState.isPending = false;
    tasksState.isError = true;
    tasksState.error = { message: 'permission denied for table tasks' };
    render(<CalendarView />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить уборки.');
    expect(alert).toHaveTextContent('permission denied for table tasks');
  });

  // Writing is off on the stand (§5): a chip shows what it would open.
  test('on the stand a chip opens a preview, not the form', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    tasksState.data = [calendarTask(1, '2026-09-28', { status: 'accepted' })];
    render(<CalendarView fixture />);

    await user.click(screen.getByRole('button', { name: /Принята/ }));

    expect(screen.queryByRole('dialog', { name: 'Форма уборки' })).toBeNull();
    expect(screen.getByRole('dialog')).toHaveTextContent('Стенд: запись выключена');
  });
});

// The owner's request of 2026-09-26: «Полный / Компактный» next to the
// filters, remembered like the depth. A compact chip is the status dot and
// the person; the window, SDT and the type live in the tooltip and the label.
describe('the compact view', () => {
  const annasSdtCleaning = () =>
    calendarTask(1, '2026-09-28', {
      assignee_id: ANNA,
      assignee: { full_name: 'Anna', role: 'cleaner' },
      time_from: '10:00:00',
      time_to: '15:00:00',
      priority: 1,
    });

  test('is chosen next to the filters, and is remembered', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<CalendarView />);

    const views = screen.getByRole('group', { name: 'Вид уборок' });
    expect(within(views).getByRole('button', { name: 'Полный' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(views).getByRole('button', { name: 'Компактный' }));
    expect(within(views).getByRole('button', { name: 'Компактный' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    unmount();
    render(<CalendarView />);
    expect(screen.getByRole('button', { name: 'Компактный' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a compact chip shows the person; the window, SDT and the type only in its label', () => {
    window.localStorage.setItem('str-ops.calendar.chip-view', 'compact');
    tasksState.data = [annasSdtCleaning()];
    render(<CalendarView />);

    const chip = screen.getByRole('button', { name: /Anna/ });
    expect(chip).toHaveTextContent(/^Anna$/);
    expect(chip).toHaveAccessibleName(/Уборка/);
    expect(chip).toHaveAccessibleName(/10:00–15:00/);
    expect(chip).toHaveAccessibleName(/SDT/);
    expect(chip).toHaveAttribute('title', chip.getAttribute('aria-label'));
  });

  test('the full chip keeps the window and SDT on it', () => {
    tasksState.data = [annasSdtCleaning()];
    render(<CalendarView />);

    const chip = screen.getByRole('button', { name: /Anna/ });
    expect(chip).toHaveTextContent('10:00–15:00');
    expect(chip).toHaveTextContent('SDT');
  });

  // Red is «Просрочено» and «Срочно» only (decision 3): nobody is the unassigned tone.
  test('a compact chip nobody holds says «Никто» in the unassigned tone', () => {
    window.localStorage.setItem('str-ops.calendar.chip-view', 'compact');
    tasksState.data = [calendarTask(1, '2026-09-28', { status: 'unassigned' })];
    render(<CalendarView />);

    const chip = screen.getByRole('button', { name: /Никто/ });
    expect(chip).toHaveTextContent(/^Никто$/);
    expect(within(chip).getByText('Никто')).toHaveClass('text-tone-unassigned-fg');
  });

  test('a week’s cell holds two compact chips where the full view shows one and «+1»', () => {
    tasksState.data = [
      calendarTask(1, '2026-09-28', { time_from: '09:00:00' }),
      calendarTask(1, '2026-09-28', { time_from: '11:00:00', type: 'inspection' }),
    ];
    const { unmount } = render(<CalendarView />);
    expect(screen.getByRole('button', { name: '+1' })).toBeInTheDocument();

    unmount();
    window.localStorage.setItem('str-ops.calendar.chip-view', 'compact');
    render(<CalendarView />);
    expect(screen.queryByRole('button', { name: '+1' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Никто/ })).toHaveLength(2);
  });
});

// The window of these tests: 25 September to 1 October 2026; today is the 26th.
describe('what never happened, the cancelled, the repairs', () => {
  const lapsed = (extra: Record<string, unknown> = {}): ExpiredTask => ({
    id: `eeeeeeee-0000-4000-8000-${String((taskSerial += 1)).padStart(12, '0')}`,
    property_id: 1,
    reservation_id: 7,
    scheduled_date: '2026-09-25',
    type: 'cleaning',
    assignee_id: ANNA,
    assignee: { full_name: 'Anna' },
    ...extra,
  });

  test('a cleaning that never happened is one mark «Не состоялась», however many rows', () => {
    expiredState.data = [lapsed(), lapsed(), lapsed()];
    render(<CalendarView />);

    expect(screen.getAllByRole('button', { name: /Не состоялась/ })).toHaveLength(1);
  });

  test('the status filter leaves the mark be; the assignee filter does not', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    expiredState.data = [lapsed()];
    render(<CalendarView />);

    await user.selectOptions(screen.getByLabelText('Статус'), 'Выполнена');
    expect(screen.getByRole('button', { name: /Не состоялась/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Исполнитель'), 'Не назначено');
    expect(screen.queryByRole('button', { name: /Не состоялась/ })).toBeNull();
  });

  test('a mark opens the drawer on the whole task', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mark = lapsed();
    expiredState.data = [mark];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: /Не состоялась/ }));

    expect(wholeTask).toHaveBeenCalledWith(mark.id);
    expect(screen.getByRole('dialog', { name: 'Шторка уборки' })).toHaveAttribute(
      'data-task',
      mark.id,
    );
  });

  test('the cancelled wait behind their switch, and open the drawer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const cancelled = calendarTask(1, '2026-09-28', { status: 'cancelled' });
    cancelledState.data = [cancelled];
    render(<CalendarView />);

    expect(screen.queryByRole('button', { name: /Отменена/ })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Показывать отменённые' }));
    await user.click(screen.getByRole('button', { name: /Отменена/ }));

    expect(screen.getByRole('dialog', { name: 'Шторка уборки' })).toHaveAttribute(
      'data-task',
      cancelled.id,
    );
  });

  // §6: overdue by the listing's own day; the chip stays on its day.
  test('a repair past its day says «Просрочен» on its chip', () => {
    tasksState.data = [
      calendarTask(1, '2026-09-25', {
        type: 'maintenance',
        problem_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        problem: { title: 'Leak', priority: 'normal' },
        property: { name: 'Anglicka 7', timezone: 'Europe/Prague' },
      }),
    ];
    render(<CalendarView />);

    expect(screen.getByRole('link', { name: /Leak/ })).toHaveAccessibleName(/Просрочен/);
  });

  const liveRepair = (extra: Record<string, unknown> = {}): LiveRepair =>
    liveRepairSchema.parse({
      id: '00000000-0000-4000-8000-000000000901',
      property_id: 1,
      problem_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'assigned',
      scheduled_date: '2026-09-20',
      assignee_id: IVA,
      assignee: { full_name: 'Iva', is_active: true },
      property: { name: 'Anglicka 7', status: 'active', timezone: 'Europe/Prague' },
      ...extra,
    });

  // Seen whatever the window: the day may be weeks behind it (§6).
  test('the row of a listing with an overdue repair carries a badge, since when and who', () => {
    repairsState.data = [liveRepair()];
    render(<CalendarView />);

    const badge = within(
      screen
        .getAllByRole('rowheader')
        .find((one) => one.getAttribute('aria-label') === 'Anglicka 7')!,
    ).getByText('Просрочен');
    expect(badge).toHaveAttribute('title', expect.stringContaining('20.09'));
    expect(badge).toHaveAttribute('title', expect.stringContaining('Iva'));
    expect(badge).not.toHaveAttribute('data-off');
  });

  test('the badge turns red when the technician no longer works here', () => {
    repairsState.data = [liveRepair({ assignee: { full_name: 'Iva', is_active: false } })];
    render(<CalendarView />);

    const badge = screen.getByText('Просрочен');
    expect(badge).toHaveAttribute('data-off', 'true');
    expect(badge).toHaveAttribute('title', expect.stringContaining('Iva — нет доступа'));
  });
});

// Review of 7.5 (2026-09-26).
describe('what never happened and the repairs, after review', () => {
  const lapsed = (extra: Record<string, unknown> = {}): ExpiredTask => ({
    id: `eeeeeeee-1000-4000-8000-${String((taskSerial += 1)).padStart(12, '0')}`,
    property_id: 1,
    reservation_id: 7,
    scheduled_date: '2026-09-25',
    type: 'cleaning',
    assignee_id: IVA,
    assignee: { full_name: 'Iva' },
    ...extra,
  });

  // A cleaner who left is in no other list the calendar reads: the mark
  // brings her name, and the select names her rather than showing an id.
  test('somebody who left and is only on marks is named on the mark and in the filter', () => {
    expiredState.data = [lapsed()];
    render(<CalendarView />);

    expect(screen.getByRole('button', { name: /Не состоялась/ })).toHaveAccessibleName(/Iva/);
    const field = screen.getByLabelText('Исполнитель');
    expect(within(field).getByRole('option', { name: 'Iva — нет доступа' })).toBeInTheDocument();
  });

  test('the assignee filter finds a mark by any of its copies', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    expiredState.data = [
      lapsed({
        id: 'eeeeeeee-2000-4000-8000-000000000001',
        assignee_id: ANNA,
        assignee: { full_name: 'Anna' },
      }),
      lapsed({ id: 'eeeeeeee-2000-4000-8000-000000000002' }),
    ];
    render(<CalendarView />);

    await user.selectOptions(screen.getByLabelText('Исполнитель'), 'Iva — нет доступа');

    expect(screen.getByRole('button', { name: /Не состоялась/ })).toHaveAccessibleName(/Iva/);
  });

  test('an overdue repair says «Просрочен» on the chip itself, not only in its tooltip', () => {
    tasksState.data = [
      calendarTask(1, '2026-09-25', {
        type: 'maintenance',
        problem_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        problem: { title: 'Leak', priority: 'normal' },
        property: { name: 'Anglicka 7', timezone: 'Europe/Prague' },
      }),
    ];
    render(<CalendarView />);

    expect(
      within(screen.getByRole('link', { name: /Leak/ })).getByText(/Просрочен/),
    ).toBeInTheDocument();
  });

  test('while the whole task is read, its card says so', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const original = wholeTask.getMockImplementation();
    wholeTask.mockImplementation(() => ({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
    }));
    expiredState.data = [lapsed()];
    try {
      render(<CalendarView />);
      await user.click(screen.getByRole('button', { name: /Не состоялась/ }));

      expect(screen.getByRole('dialog')).toHaveTextContent('Загружаем уборки…');
    } finally {
      if (original) {
        wholeTask.mockImplementation(original);
      }
    }
  });

  test('while the repairs load, the calendar says so', () => {
    repairsState.data = undefined;
    repairsState.isPending = true;
    try {
      render(<CalendarView />);

      expect(screen.getByText('Загружаем уборки…')).toBeInTheDocument();
    } finally {
      repairsState.isPending = false;
    }
  });
});

// The branch preflight of 2026-09-27.
describe('after the branch preflight', () => {
  const closedCopy = (id: string): ExpiredTask => ({
    id,
    property_id: 1,
    reservation_id: 7,
    scheduled_date: '2026-09-25',
    type: 'cleaning',
    assignee_id: ANNA,
    assignee: { full_name: 'Anna' },
  });

  // The owner's word of 2026-10-04: a day is too narrow to plan by; three is the least.
  test('there is no one-day depth: three days is the shortest', () => {
    render(<CalendarView />);

    const depths = within(screen.getByRole('group', { name: 'Глубина' }))
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(depths).toEqual(['3 дня', '7 дней', '15 дней', '30 дней']);
  });

  test('a depth of one day remembered from before opens the week', () => {
    window.localStorage.setItem('str-ops.calendar.depth', '1');
    render(<CalendarView />);

    expect(days()).toHaveLength(7);
    expect(days()[0]).toBe('2026-09-25');
  });

  test('a task a fresher layer has closed is drawn once, as closed', () => {
    const task = calendarTask(1, '2026-09-25', { status: 'assigned' });
    tasksState.data = [task];
    expiredState.data = [closedCopy(task.id)];
    render(<CalendarView />);

    expect(screen.queryByRole('button', { name: /Назначена/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Не состоялась/ })).toHaveLength(1);
  });

  test('a cancelled copy wins over a stale live one', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const task = calendarTask(1, '2026-09-28', { status: 'assigned' });
    tasksState.data = [task];
    cancelledState.data = [{ ...task, status: 'cancelled' }];
    render(<CalendarView />);

    await user.click(screen.getByRole('checkbox', { name: 'Показывать отменённые' }));

    expect(screen.queryByRole('button', { name: /Назначена/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Отменена/ })).toHaveLength(1);
  });

  test("the booking card names the status in words, not Hostaway's code", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    bookingsState.data = [booking(1, 1, '2026-09-26', '2026-09-28', { guest_name: 'Jan Novak' })];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: /Jan Novak/ }));

    const card = screen.getByRole('dialog');
    expect(card).toHaveTextContent('Новая');
    expect(within(card).queryByText('new')).toBeNull();
  });

  test('when the staff cannot be read, it says so beside the filters', () => {
    const saved = { ...staffState };
    Object.assign(staffState, { data: undefined, isError: true, error: { message: 'boom' } });
    try {
      render(<CalendarView />);

      expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить сотрудников');
    } finally {
      Object.assign(staffState, saved);
    }
  });

  test('every drawn row says which row of the grid it is', () => {
    render(<CalendarView />);

    const rows = screen.getAllByRole('row');
    expect(rows[0]).toHaveAttribute('aria-rowindex', '1');
    expect(rows[1]).toHaveAttribute('aria-rowindex', '2');
  });
});

/**
 * The owner's word of 2026-10-04: the calendar finds a listing by its name the
 * way the registry does (`lib/search.ts`, `rowsMatching`) — a listing found
 * keeps its rooms, a room found stands under its listing, and the marks of a
 * letter do not count.
 */
describe('the search', () => {
  const names = () =>
    screen
      .getAllByRole('rowheader')
      .map((cell) => within(cell).getByTestId('row-name').textContent);
  const searchBox = () => screen.getByRole('searchbox', { name: 'Найти объект по названию' });

  test('finds a listing without its diacritics, and leaves the rest out', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    rowsState.data = [...SMALL, row(30, 'Šárka 5')];
    render(<CalendarView />);

    await user.type(searchBox(), 'sarka');

    expect(names()).toEqual(['Šárka 5']);
  });

  test('a listing found shows all of its rooms', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarView />);

    await user.type(searchBox(), 'royal');

    expect(names()).toEqual(['Royal Cerna', 'Unit 1', 'Unit 2']);
  });

  test('a room found stands under its listing, without the other rooms', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarView />);

    await user.type(searchBox(), 'unit 2');

    expect(names()).toEqual(['Royal Cerna', 'Unit 2']);
  });

  test('a closed group opens while a room in it is found, and closes again after', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarView />);
    await user.click(screen.getByRole('button', { name: 'Скрыть единицы «Royal Cerna»' }));

    await user.type(searchBox(), 'unit 2');
    expect(names()).toEqual(['Royal Cerna', 'Unit 2']);

    await user.clear(searchBox());
    expect(names()).toEqual([
      'Anglicka 7',
      'Royal Cerna',
      'Villa Whole',
      'Villa East',
      'Villa West',
    ]);
  });

  test('when nothing is found it says so, and clearing brings every row back', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarView />);

    await user.type(searchBox(), 'zizkov');
    expect(screen.getByText('Объектов с таким названием нет.')).toBeInTheDocument();
    expect(screen.queryAllByRole('rowheader')).toEqual([]);

    await user.clear(searchBox());
    expect(names()).toHaveLength(SMALL.length);
  });
});

// The owner's word of 2026-10-10 (block 7): the past up to sixty days back, on
// demand, in chunks; the button is the way for the keyboard and the touch.
// Today is 26 September: the window is 25 September to 1 October, the first
// chunk 11–24 September, the limit 28 July.
describe('the past', () => {
  const PAST_BUTTON = 'Показать прошлое';
  const deferred = () => {
    let resolve: () => void = () => {};
    let reject: (error: unknown) => void = () => {};
    const promise = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  };

  test('is not there when the calendar opens, and nothing of it is read', () => {
    render(<CalendarView />);

    expect(days()).toHaveLength(7);
    expect(days()[0]).toBe('2026-09-25');
    expect(screen.getByRole('button', { name: PAST_BUTTON })).toBeEnabled();
    expect(pastLoad).not.toHaveBeenCalled();
  });

  test('«Показать прошлое» puts two weeks before the window once they are read', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const answer = deferred();
    pastLoad.mockReturnValueOnce(answer.promise);
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: PAST_BUTTON }));

    expect(pastLoad).toHaveBeenCalledTimes(1);
    expect(pastLoad.mock.calls[0][0][0]).toBe('2026-09-11');
    expect(pastLoad.mock.calls[0][0]).toHaveLength(14);
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем прошлое…');
    expect(days()).toHaveLength(7);

    await act(async () => answer.resolve());

    expect(days()).toHaveLength(21);
    expect(days()[0]).toBe('2026-09-11');
    expect(days()[14]).toBe('2026-09-25');
    expect(screen.queryByText('Загружаем прошлое…')).toBeNull();
  });

  test('at sixty days back the button says it is the limit, and does nothing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarView />);

    for (let press = 0; press < 5; press += 1) {
      await user.click(screen.getByRole('button', { name: PAST_BUTTON }));
    }

    expect(days()[0]).toBe('2026-07-28');
    const limit = screen.getByRole('button', { name: 'Прошлое — не дальше 60 дней назад' });
    expect(limit).toBeDisabled();
    expect(screen.queryByRole('button', { name: PAST_BUTTON })).toBeNull();
    expect(pastLoad).toHaveBeenCalledTimes(5);
  });

  test('a chunk that fails says so, with the server’s words and a retry, and keeps what is shown', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    pastLoad.mockRejectedValueOnce({ message: 'canceling statement due to statement timeout' });
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: PAST_BUTTON }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить прошлое.');
    expect(alert).toHaveTextContent('canceling statement due to statement timeout');
    expect(days()).toHaveLength(7);

    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(pastLoad).toHaveBeenCalledTimes(2);
    expect(pastLoad.mock.calls[1][0]).toEqual(pastLoad.mock.calls[0][0]);
    expect(days()).toHaveLength(21);
    expect(screen.queryByText('Не удалось загрузить прошлое.')).toBeNull();
  });

  test('the arrows, a depth and «Сегодня» drop it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: PAST_BUTTON }));
    await user.click(screen.getByRole('button', { name: 'Следующий период' }));
    await user.click(screen.getByRole('button', { name: 'Предыдущий период' }));
    expect(days()).toHaveLength(7);
    expect(days()[0]).toBe('2026-09-25');

    await user.click(screen.getByRole('button', { name: PAST_BUTTON }));
    await user.click(screen.getByRole('button', { name: '15 дней' }));
    expect(days()).toHaveLength(15);

    await user.click(screen.getByRole('button', { name: PAST_BUTTON }));
    await user.click(screen.getByRole('button', { name: 'Сегодня' }));
    expect(days()).toHaveLength(15);
    expect(days()[0]).toBe('2026-09-25');
  });

  test('shows the cancelled whatever their switch; the window keeps them behind it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const before = calendarTask(1, '2026-09-20', { status: 'cancelled' });
    const inWindow = calendarTask(1, '2026-09-28', { status: 'cancelled' });
    cancelledState.data = [before, inWindow];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: PAST_BUTTON }));

    const shown = screen.getAllByRole('button', { name: /Отменена/ });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveAttribute('data-task-chip', before.id);
  });

  test('shows the done, the live and what never happened on its days, and the bars', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    bookingsState.data = [booking(301, 1, '2026-09-14', '2026-09-17')];
    tasksState.data = [
      calendarTask(1, '2026-09-17', { status: 'done' }),
      calendarTask(1, '2026-09-18', { status: 'in_progress' }),
    ];
    expiredState.data = [
      {
        id: 'eeeeeeee-0000-4000-8000-000000009001',
        property_id: 1,
        reservation_id: 9,
        scheduled_date: '2026-09-12',
        type: 'cleaning',
        assignee_id: null,
        assignee: null,
      },
    ];
    render(<CalendarView />);

    await user.click(screen.getByRole('button', { name: PAST_BUTTON }));

    const cell = rowCell('Anglicka 7');
    expect(within(cell).getByRole('button', { name: /Guest 301/ })).toBeInTheDocument();
    expect(within(cell).getByRole('button', { name: /Выполнена/ })).toBeInTheDocument();
    expect(within(cell).getByRole('button', { name: /В работе/ })).toBeInTheDocument();
    expect(within(cell).getByRole('button', { name: /Не состоялась/ })).toBeInTheDocument();
  });

  test('an empty day of the past takes no new cleaning; a day of the window still does', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarView />);
    await user.click(screen.getByRole('button', { name: PAST_BUTTON }));

    // jsdom lays nothing out: the cell starts at 0; the fourth day is 14 September.
    fireEvent.click(rowCell('Anglicka 7'), { clientX: 3 * 130 + 5 });
    expect(screen.queryByRole('dialog', { name: 'Форма уборки' })).toBeNull();

    // The first day of the window, 25 September, is the fifteenth.
    fireEvent.click(rowCell('Anglicka 7'), { clientX: 14 * 130 + 5 });
    expect(screen.getByRole('dialog', { name: 'Форма уборки' })).toHaveAttribute(
      'data-day',
      '2026-09-25',
    );
  });
});
