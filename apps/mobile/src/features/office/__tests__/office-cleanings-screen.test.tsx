import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import FirstTab from '@/app/(tabs)/index';
import { pinToday } from '@/testing/clock';
import { CLEANER_VERA, ROYAL_ROOM, officeTask } from '@/testing/office-fixtures';
import { withClient } from '@/testing/restored-cache';

import { fetchOfficeTasks } from '../api';
import type { DayRange, OfficeTask } from '../schema';

/**
 * The office's «Уборки» on the phone (owner, 2026-11-18): every cleaning of
 * the company by day, or a month's calendar with the picked day under it;
 * filtered by days, status and place. Only the days on screen are read.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

let mockRole = 'manager';

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: '00000000-0000-4000-8000-00000000000a',
    isLoading: false,
    session: { user: { app_metadata: { role: mockRole } } },
  }),
}));

jest.mock('../api', () => ({ fetchOfficeTasks: jest.fn(), fetchOfficeTask: jest.fn() }));

// The cleaner's own list, for the one test that she still gets it.
jest.mock('@/features/tasks/use-tasks', () => ({
  ...jest.requireActual<typeof import('@/features/tasks/use-tasks')>('@/features/tasks/use-tasks'),
  useMyTasks: () => ({
    data: [],
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
  }),
  useMyDoneTasks: () => ({ data: undefined, refetch: jest.fn(), fetchNextPage: jest.fn() }),
  useAcceptTask: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set(), problems: new Set(), refetch: jest.fn() }),
}));

const ANNA_TODAY = officeTask();
const HANDED_BACK = officeTask({
  id: '4a3b2c1d-6e5f-4a7b-8c9d-0e1f2a3b4c5d',
  property_id: 2109,
  property: ROYAL_ROOM,
  status: 'unassigned',
  assignee_id: null,
  assignee: null,
  time_from: '11:00:00',
  release_kind: 'declined',
  offs: {
    cancelled: null,
    released: {
      kind: 'declined',
      at: '2026-11-18T07:00:00+00:00',
      by: { id: CLEANER_VERA, name: 'Вера Новак', role: 'cleaner' },
      reason: 'Заболела',
    },
  },
});
const DONE_TOMORROW = officeTask({
  id: '5b4c3d2e-7f60-4b8c-9dae-1f2a3b4c5d6e',
  scheduled_date: '2026-11-19',
  status: 'done',
});
const CANCELLED_TODAY = officeTask({
  id: '6c5d4e3f-8071-4c9d-8ebf-2a3b4c5d6e7f',
  status: 'cancelled',
  property: { ...ROYAL_ROOM, name: '2 - 2110' },
  property_id: 2110,
  time_from: '12:00:00',
});

const ALL = [ANNA_TODAY, HANDED_BACK, CANCELLED_TODAY, DONE_TOMORROW];

/** The server: the cleanings on the days asked. */
function serve(rows: readonly OfficeTask[]): void {
  jest
    .mocked(fetchOfficeTasks)
    .mockImplementation(async ({ from, to }: DayRange) =>
      rows.filter((task) => task.scheduled_date >= from && task.scheduled_date < to),
    );
}

function ranges(): DayRange[] {
  return jest.mocked(fetchOfficeTasks).mock.calls.map(([range]) => range);
}

async function show(): Promise<void> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(<FirstTab />, { wrapper: withClient(client) });
}

function rowNames(): string[] {
  return screen
    .queryAllByTestId('office-task-row')
    .map((row) => row.props.accessibilityLabel as string);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'manager';
  pinToday(new Date(2026, 10, 18, 9, 0));
  serve(ALL);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the list', () => {
  test('today’s cleanings of everybody, who is on each, the cancelled left out', async () => {
    await show();

    expect(await screen.findByText('Анна Белова')).toBeTruthy();
    expect(ranges()).toEqual([{ from: '2026-11-18', to: '2026-11-19' }]);
    expect(screen.getByRole('header', { name: 'Сегодня' })).toBeTruthy();
    expect(rowNames()).toHaveLength(2);
    expect(rowNames()[0]).toContain('CZ - Nadrazni Apt 6');
    expect(rowNames()[0]).toContain('Анна Белова');
    expect(rowNames()[1]).toContain('Без исполнителя');
    expect(rowNames()[1]).toContain('Отказ: Вера Новак');
    expect(screen.queryByText('2 - 2110', { exact: false })).toBeNull();
  });

  test('«Отменённые» shows the cancelled, and only them', async () => {
    await show();
    await screen.findByText('Анна Белова');

    await fireEvent.press(screen.getByRole('tab', { name: 'Отменённые' }));

    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toContain('Отменена');
  });

  test('«7 дней» reads the week from today, a section per day', async () => {
    await show();
    await screen.findByText('Анна Белова');

    await fireEvent.press(screen.getByRole('tab', { name: '7 дней' }));

    expect(await screen.findByRole('header', { name: 'Завтра' })).toBeTruthy();
    expect(ranges()).toContainEqual({ from: '2026-11-18', to: '2026-11-25' });
    expect(rowNames()).toHaveLength(3);
  });

  test('a place is picked on its sheet, the houses of the rows read', async () => {
    await show();
    await screen.findByText('Анна Белова');

    await fireEvent.press(screen.getByRole('button', { name: 'Объект: Все объекты' }));
    const sheet = within(screen.getByTestId('office-place-sheet'));
    expect(sheet.getByRole('button', { name: 'CZ - Nadrazni Apt 6, 1 уборка' })).toBeTruthy();
    await fireEvent.press(sheet.getByRole('button', { name: 'CZ - Vinohradska Royal, 2 уборки' }));

    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toContain('CZ - Vinohradska Royal');
    expect(screen.getByRole('button', { name: 'Объект: CZ - Vinohradska Royal' })).toBeTruthy();
  });

  test('a row opens the cleaning', async () => {
    await show();
    await screen.findByText('Анна Белова');

    await fireEvent.press(screen.getAllByTestId('office-task-row')[0]);

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/task/[id]',
      params: { id: ANNA_TODAY.id },
    });
  });

  test('a filter that hides everything offers the way back; a day with nothing says so', async () => {
    serve([ANNA_TODAY]);
    await show();
    await screen.findByText('Анна Белова');

    await fireEvent.press(screen.getByRole('tab', { name: 'Выполнены' }));
    expect(screen.getByText('Под эти фильтры ничего не подходит')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(screen.getByText('Анна Белова')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Завтра' }));
    expect(await screen.findByText('Уборок нет')).toBeTruthy();
  });

  test('a read that never landed says so and is asked again', async () => {
    jest.mocked(fetchOfficeTasks).mockRejectedValue(new TypeError('Network request failed'));
    await show();

    expect(await screen.findByText('Не удалось загрузить уборки')).toBeTruthy();
    serve(ALL);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('Анна Белова')).toBeTruthy();
  });
});

describe('the calendar', () => {
  async function openCalendar(): Promise<void> {
    await show();
    await screen.findByText('Анна Белова');
    await fireEvent.press(screen.getByRole('tab', { name: 'Календарь' }));
    await waitFor(() =>
      expect(ranges()).toContainEqual({ from: '2026-11-01', to: '2026-12-01' }),
    );
  }

  test('reads the month, and counts each day’s cleanings in words', async () => {
    await openCalendar();

    const today = await screen.findByTestId('month-grid-day-2026-11-18');
    await waitFor(() =>
      expect(today.props.accessibilityLabel).toContain('2 уборки, есть уборки без исполнителя'),
    );
    expect(screen.getByTestId('month-grid-day-2026-11-19').props.accessibilityLabel).toContain(
      '1 уборка',
    );
    expect(today.props.accessibilityState).toMatchObject({ selected: true });
    expect(rowNames()).toHaveLength(2);
  });

  test('a day picked lists its cleanings under the grid; tomorrow is the list’s «Завтра»', async () => {
    await openCalendar();
    await screen.findByText('Анна Белова');

    await fireEvent.press(screen.getByTestId('month-grid-day-2026-11-19'));

    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toContain('Выполнена');

    await fireEvent.press(screen.getByRole('tab', { name: 'Список' }));
    expect(screen.getByRole('tab', { name: 'Завтра' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    await waitFor(() => expect(rowNames()).toHaveLength(1));
    expect(ranges()).toContainEqual({ from: '2026-11-19', to: '2026-11-20' });
  });

  test('any other day picked becomes a chip of its own in the list', async () => {
    await openCalendar();

    await fireEvent.press(screen.getByTestId('month-grid-day-2026-11-21'));
    expect(await screen.findByText('В этот день уборок нет')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Список' }));

    const days = within(screen.getByLabelText('Дата')).getAllByRole('tab');
    expect(days).toHaveLength(4);
    expect(days[3].props.accessibilityLabel).toContain('21');
    expect(days[3].props.accessibilityState).toMatchObject({ selected: true });
    await waitFor(() =>
      expect(ranges()).toContainEqual({ from: '2026-11-21', to: '2026-11-22' }),
    );
  });

  test('a day with nothing on it says so, whatever the filters hide on other days', async () => {
    await openCalendar();
    await fireEvent.press(screen.getByRole('tab', { name: 'Выполнены' }));

    await fireEvent.press(screen.getByTestId('month-grid-day-2026-11-21'));

    expect(screen.getByText('В этот день уборок нет')).toBeTruthy();
    expect(screen.queryByText('Под эти фильтры ничего не подходит')).toBeNull();
  });

  test('the next month is read when it is shown, and opens on its first day', async () => {
    await openCalendar();

    await fireEvent.press(screen.getByRole('button', { name: 'Следующий месяц' }));

    await waitFor(() =>
      expect(ranges()).toContainEqual({ from: '2026-12-01', to: '2027-01-01' }),
    );
    expect(
      screen.getByTestId('month-grid-day-2026-12-01').props.accessibilityState,
    ).toMatchObject({ selected: true });
  });
});

test('a cleaner still gets her own list: the office’s is never read', async () => {
  mockRole = 'cleaner';

  await show();

  expect(screen.queryByRole('tab', { name: 'Календарь' })).toBeNull();
  expect(fetchOfficeTasks).not.toHaveBeenCalled();
});
