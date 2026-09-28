import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import MyTasksScreen from '@/app/(tabs)/index';
import { RefusalError } from '@/lib/server-error';

import type { CleaningTask } from '../schema';
import { useAcceptTask } from '../use-tasks';

/**
 * Her own list, wired: accepting tomorrow's cleanings without opening each.
 * The route is thin, so the hooks under it are replaced and what is asserted
 * is what she sees and where a tap takes her.
 */

let mockParams: Record<string, string | undefined> = {};

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

jest.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set(), problems: new Set(), refetch: jest.fn() }),
}));

const mockRefetch = jest.fn();

jest.mock('../use-tasks', () => ({
  useMyTasks: () => ({
    data: mockTasks,
    isPending: false,
    error: null,
    refetch: mockRefetch,
    isRefetching: false,
  }),
  useAcceptTask: jest.fn(),
  // What an accept sends is the screen's real contract, not something to fake.
  acceptVariables: jest.requireActual('../use-tasks').acceptVariables,
}));

const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

const mockTask: CleaningTask = {
  id: TASK_ID,
  status: 'assigned',
  priority: 0,
  scheduled_date: '2026-11-10',
  due_at: null,
  assignee_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
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

/** Her list as the screen gets it; a test adds a second cleaning when it needs one. */
const mockTasks: CleaningTask[] = [mockTask];

const mutateAsync = jest.fn();

const SECOND_ID = '9d2ff806-4bea-4aa5-be3c-1b07a629dbee';

beforeEach(() => {
  jest.clearAllMocks();
  mockTasks.splice(0, mockTasks.length, mockTask);
  mutateAsync.mockResolvedValue(undefined);
  jest
    .mocked(useAcceptTask)
    .mockReturnValue({ mutateAsync } as unknown as ReturnType<typeof useAcceptTask>);
});

test('accepting from the list sends the accept and does not open the cleaning', async () => {
  // Arrange
  await render(<MyTasksScreen />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: /^Принять/ }));

  // Assert
  // With the day and the flat she saw: accepted means accepted as shown.
  expect(mutateAsync).toHaveBeenCalledWith({
    taskId: TASK_ID,
    scheduledDate: '2026-11-10',
    propertyId: 412432,
  });
  expect(router.push).not.toHaveBeenCalled();
});

test('a refused accept is said in her words, and the list is refreshed to show why', async () => {
  // Arrange
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mutateAsync.mockRejectedValue(new RefusalError('Accept matched no row', 'tasks.acceptFailed'));
  await render(<MyTasksScreen />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: /^Принять/ }));

  // Assert
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith(
      'Не получилось принять уборку',
      'Не удалось принять уборку — её могли передать, перенести или отменить.',
    ),
  );
  expect(mockRefetch).toHaveBeenCalled();
});

test('accepting several in a row, every refusal is said, not only the last one', async () => {
  // Arrange: tomorrow's two cleanings, both taken from her in the meantime.
  // One mutation hook serves the whole list, and the callbacks of an earlier
  // mutate() are dropped once a later one is made — each card keeps its own
  // promise instead.
  mockTasks.push({ ...mockTask, id: SECOND_ID });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mutateAsync.mockRejectedValue(new RefusalError('Accept matched no row', 'tasks.acceptFailed'));
  await render(<MyTasksScreen />);
  const [first, second] = screen.getAllByRole('button', { name: /^Принять/ });

  // Act
  await fireEvent.press(first);
  await fireEvent.press(second);

  // Assert
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  expect(mutateAsync.mock.calls.map(([variables]) => variables.taskId)).toEqual([
    TASK_ID,
    SECOND_ID,
  ]);
});

test('the card still opens the cleaning', async () => {
  // Arrange
  await render(<MyTasksScreen />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: /^CZ - Nadrazni Apt 6\./ }));

  // Assert
  expect(router.push).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: TASK_ID } });
  expect(mutateAsync).not.toHaveBeenCalled();
});

describe('after a tap on a push about a cleaning that is no longer hers', () => {
  afterEach(() => {
    mockParams = {};
  });

  test.each([
    ['unassigned', 'Эту уборку с вас сняли.'],
    ['cancelled', 'Эту уборку отменили.'],
    ['movedAway', 'Уборку перенесли, и в вашем списке её сейчас нет.'],
  ])('%s: her list says what happened', async (notice, text) => {
    mockParams = { notice };

    await render(<MyTasksScreen />);

    expect(screen.getByText(text)).toBeTruthy();
  });

  test('the line goes once she has read it', async () => {
    mockParams = { notice: 'cancelled' };
    await render(<MyTasksScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Скрыть' }));

    expect(router.setParams).toHaveBeenCalledWith({ notice: undefined });
  });

  test('a notice the app does not know says nothing', async () => {
    mockParams = { notice: 'somethingElse' };

    await render(<MyTasksScreen />);

    expect(screen.queryByRole('button', { name: 'Скрыть' })).toBeNull();
  });
});
