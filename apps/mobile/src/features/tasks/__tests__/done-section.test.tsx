import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import MyTasksScreen from '@/app/(tabs)/index';
import { setWordContext } from '@/testing/word-context';

import type { CleaningTask } from '../schema';

/**
 * «Выполненные» on «Мои» (owner, 2026-10-10): her finished jobs of the last
 * 30 days below her open list, read only when she asks for them, twenty at a
 * time with «Показать ещё», each opening the job's own screen to read. The
 * route is thin, so the hooks under it are replaced; what is asserted is what
 * she sees and where a tap takes her.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

jest.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set(), problems: new Set(), refetch: jest.fn() }),
}));

/** What the done list's hook reports; each test sets the state it is about. */
const mockDone: {
  data: CleaningTask[] | undefined;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: jest.Mock;
  refetch: jest.Mock;
} = {
  data: undefined,
  error: null,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: jest.fn(),
  refetch: jest.fn(),
};
/** Whether the screen asked for the done list to be read: its one argument. */
const mockDoneOpened = jest.fn();
const mockOpen: CleaningTask[] = [];

jest.mock('../use-tasks', () => ({
  useMyTasks: () => ({
    data: mockOpen,
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
  }),
  useMyDoneTasks: (isOpen: boolean) => {
    mockDoneOpened(isOpen);
    return isOpen ? mockDone : { ...mockDone, data: undefined, error: null, hasNextPage: false };
  },
  useAcceptTask: () => ({ mutateAsync: jest.fn() }),
  acceptVariables: jest.fn(),
}));

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const DONE_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const OPEN_ID = '9d2ff806-4bea-4aa5-be3c-1b07a629dbee';

function job(overrides: Partial<CleaningTask> = {}): CleaningTask {
  return {
    id: DONE_ID,
    status: 'done',
    priority: 0,
    scheduled_date: '2026-10-09',
    due_at: null,
    assignee_id: ME,
    property_id: 412432,
    property: {
      name: 'CZ - Nadrazni Apt 6',
      address: 'Nádražní 6',
      hostaway_unit_id: null,
      effective_cleaner_notes: null,
      parent: null,
    },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: null,
    started_at: '2026-10-09T08:05:00+00:00',
    completed_at: '2026-10-09T10:40:00+00:00',
    is_parallel: false,
    type: 'cleaning',
    notes: null,
    title: null,
    title_i18n: {},
    ...overrides,
  };
}

const OPEN_JOB = job({
  id: OPEN_ID,
  status: 'assigned',
  scheduled_date: '2026-11-10',
  started_at: null,
  completed_at: null,
  property: {
    name: 'CZ - Vinohradska 12',
    address: 'Vinohradská 12',
    hostaway_unit_id: null,
    effective_cleaner_notes: null,
    parent: null,
  },
});

const HEADING = 'Выполненные за 30 дней';

async function openDone(): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: HEADING }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOpen.splice(0, mockOpen.length, OPEN_JOB);
  mockDone.data = [job()];
  mockDone.error = null;
  mockDone.hasNextPage = false;
  mockDone.isFetchingNextPage = false;
});

test('closed: a button below her list names the window, and nothing is read', async () => {
  await render(<MyTasksScreen />);

  expect(screen.getByRole('button', { name: HEADING })).toBeTruthy();
  expect(mockDoneOpened).toHaveBeenLastCalledWith(false);
  expect(screen.queryByText(/^Завершена/)).toBeNull();
});

test('opened: her finished jobs under their heading, each saying when it was finished', async () => {
  await render(<MyTasksScreen />);

  await openDone();

  expect(mockDoneOpened).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('header', { name: HEADING })).toBeTruthy();
  expect(screen.getByText(/^Завершена .+, \d{2}:\d{2}$/)).toBeTruthy();
  // Her open list stays above it.
  expect(screen.getByText('CZ - Vinohradska 12')).toBeTruthy();
});

test('a finished job opens its own screen, where there is nothing left to do', async () => {
  await render(<MyTasksScreen />);
  await openDone();

  await fireEvent.press(screen.getByRole('button', { name: /^CZ - Nadrazni Apt 6\. Завершена/ }));

  expect(router.push).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: DONE_ID } });
});

test('a finished job’s row offers no move of its own', async () => {
  mockOpen.splice(0, mockOpen.length);
  mockDone.data = [job({ status: 'done' })];
  await render(<MyTasksScreen />);
  await openDone();

  expect(screen.queryByRole('button', { name: /^Принять/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Взять/ })).toBeNull();
});

test('a full page offers «Показать ещё», which reads the next one', async () => {
  mockDone.hasNextPage = true;
  await render(<MyTasksScreen />);
  await openDone();

  await fireEvent.press(screen.getByRole('button', { name: 'Показать ещё' }));

  expect(mockDone.fetchNextPage).toHaveBeenCalledTimes(1);
});

test('while the next page is read, «Показать ещё» is held', async () => {
  mockDone.hasNextPage = true;
  mockDone.isFetchingNextPage = true;
  await render(<MyTasksScreen />);
  await openDone();

  const more = screen.getByRole('button', { name: 'Показать ещё' });
  expect(more.props.accessibilityState).toMatchObject({ busy: true });
  await fireEvent.press(more);
  expect(mockDone.fetchNextPage).not.toHaveBeenCalled();
});

test('the last page: no «Показать ещё»', async () => {
  await render(<MyTasksScreen />);
  await openDone();

  expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
});

test('nothing finished in the window: it says so under the heading', async () => {
  mockDone.data = [];
  await render(<MyTasksScreen />);

  await openDone();

  expect(screen.getByRole('header', { name: HEADING })).toBeTruthy();
  expect(screen.getByText('За этот срок ничего не завершено')).toBeTruthy();
});

test('while the first page is read, it says so', async () => {
  mockDone.data = undefined;
  await render(<MyTasksScreen />);

  await openDone();

  expect(screen.getByText('Загружаем выполненные…')).toBeTruthy();
});

test('a read that failed says so, and «Повторить» asks again', async () => {
  mockDone.data = undefined;
  mockDone.error = new Error('Network request failed');
  await render(<MyTasksScreen />);
  await openDone();

  expect(screen.getByText('Не удалось загрузить выполненные')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

  expect(mockDone.refetch).toHaveBeenCalledTimes(1);
});

test('with nothing open, her empty list still says so above what she finished', async () => {
  mockOpen.splice(0, mockOpen.length);
  await render(<MyTasksScreen />);

  await openDone();

  expect(screen.getByText(/^Пока нет назначенных уборок/)).toBeTruthy();
  expect(screen.getByRole('header', { name: HEADING })).toBeTruthy();
  expect(screen.getByText(/^Завершена/)).toBeTruthy();
});

test('a technician’s finished repair is named by what was fixed, never as a cleaning', async () => {
  await setWordContext('tech');
  try {
    mockOpen.splice(0, mockOpen.length);
    mockDone.data = [
      job({
        type: 'maintenance',
        reservation_id: null,
        problem: {
          id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40101',
          title: 'Течёт смеситель',
          priority: 'normal',
        },
      }),
    ];
    await render(<MyTasksScreen />);
    await openDone();

    expect(screen.getByRole('button', { name: /^Течёт смеситель\. Завершена/ })).toBeTruthy();
    expect(screen.queryByText(/уборк/i)).toBeNull();
  } finally {
    await setWordContext(undefined);
  }
});
