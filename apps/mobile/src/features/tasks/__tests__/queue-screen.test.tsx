import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import FreeQueueScreen from '@/app/(tabs)/queue';
import { RefusalError } from '@/lib/server-error';

import { calendarDay, type CleaningTask } from '../schema';
import { useClaimTask } from '../use-tasks';

/**
 * The queue of free work, wired: the list, the claim and the way into a task.
 * The route is thin, so the hooks under it are replaced and what is asserted
 * is what she sees and where a tap takes her.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

jest.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set(), problems: new Set(), refetch: jest.fn() }),
}));

const mockRefetch = jest.fn();

jest.mock('../use-tasks', () => ({
  useFreeTasks: () => ({
    data: mockTasks,
    isPending: false,
    error: null,
    refetch: mockRefetch,
    isRefetching: false,
  }),
  useClaimTask: jest.fn(),
}));

const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

const mockTask: CleaningTask = {
  id: TASK_ID,
  status: 'unassigned',
  priority: 0,
  scheduled_date: '2026-11-10',
  due_at: null,
  assignee_id: null,
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
  started_at: null,
  completed_at: null,
  is_parallel: false,
  type: 'cleaning',
  notes: null,
  title: null,
  title_i18n: {},
};

/** The queue as the screen gets it; a test puts other days in when it needs them. */
const mockTasks: CleaningTask[] = [mockTask];

const SECOND_ID = '9d2ff806-4bea-4aa5-be3c-1b07a629dbee';

interface MutateOptions {
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

const mutate = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockTasks.splice(0, mockTasks.length, mockTask);
  jest
    .mocked(useClaimTask)
    .mockReturnValue({ mutate } as unknown as ReturnType<typeof useClaimTask>);
});

/** Taps "Взять" and has the claim fail the way the server answered. */
async function claimFailingWith(error: Error): Promise<jest.SpyInstance> {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<FreeQueueScreen />);

  await fireEvent.press(screen.getByRole('button', { name: /^Взять/ }));
  const options = mutate.mock.calls[0][1] as MutateOptions;
  options.onError?.(error);

  return alert;
}

test('a claim the server refused in its own words is said in hers, with the words as a paragraph under it', async () => {
  // Arrange / Act
  const alert = await claimFailingWith(new Error('permission denied for table tasks'));

  // Assert
  expect(alert).toHaveBeenCalledWith(
    'Не получилось взять уборку',
    'Не удалось выполнить действие. Попробуйте ещё раз.\n\npermission denied for table tasks',
  );
  expect(mockRefetch).toHaveBeenCalled();
});

test('a lost race is the one sentence that explains it, with nothing raw under it', async () => {
  // Arrange / Act
  const alert = await claimFailingWith(
    new RefusalError('Claim matched no row: taken or past its day', 'tasks.claimTaken'),
  );

  // Assert
  expect(alert).toHaveBeenCalledWith(
    'Не получилось взять уборку',
    'Уборку уже взяли, либо её срок истёк.',
  );
});

test('a free task opens before it is taken: the notes and the chat are read first', async () => {
  // Arrange
  await render(<FreeQueueScreen />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: /^CZ - Nadrazni Apt 6\./ }));

  // Assert
  expect(router.push).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: TASK_ID } });
  expect(mutate).not.toHaveBeenCalled();
});

test('taking a task from the queue does not also open it', async () => {
  // Arrange
  await render(<FreeQueueScreen />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: /^Взять/ }));

  // Assert
  expect(mutate).toHaveBeenCalledWith(
    { taskId: TASK_ID, cleanerId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
    expect.any(Object),
  );
  expect(router.push).not.toHaveBeenCalled();
});

test('free work stands under its day: today, tomorrow, each a heading of its own', async () => {
  // Arrange: one free cleaning today and one tomorrow, by the phone's calendar.
  const now = new Date();
  mockTasks.splice(
    0,
    mockTasks.length,
    { ...mockTask, scheduled_date: calendarDay(now) },
    { ...mockTask, id: SECOND_ID, scheduled_date: calendarDay(now, 1) },
  );

  // Act
  await render(<FreeQueueScreen />);

  // Assert
  expect(screen.getAllByRole('header').map((heading) => heading.props.children)).toEqual([
    'Сегодня',
    'Завтра',
  ]);
  expect(screen.getAllByRole('button', { name: /^Взять/ })).toHaveLength(2);
});

test('while the claim runs, its button says so and a second tap sends nothing', async () => {
  // Arrange: the claim is on its way — mutate() has not settled.
  await render(<FreeQueueScreen />);
  const take = () => screen.getByRole('button', { name: /^Взять/ });

  // Act
  await fireEvent.press(take());
  await fireEvent.press(take());

  // Assert
  expect(take().props.accessibilityState).toMatchObject({ busy: true });
  expect(mutate).toHaveBeenCalledTimes(1);
});
