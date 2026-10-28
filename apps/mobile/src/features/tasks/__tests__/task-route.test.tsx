import { fireEvent, render, screen } from '@testing-library/react-native';

import TaskRoute from '@/app/task/[id]';
import { setWordContext } from '@/testing/word-context';

import type { CleaningTask } from '../schema';

/**
 * A notification opens the app cold, straight onto the cleaning. The stored
 * session is read a moment later; until then the screen must not say the
 * cleaning is gone. Once she is known, the cleaning loads — its shape while it
 * does, and a failure in her language if it cannot.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const mockSession = {
  userId: null as string | null,
  isLoading: true,
  /** The token's role, in `app_metadata`; none — the cleaner's view — unless a test says so. */
  session: null as { user: { app_metadata: { role: string } } } | null,
};

/** What the task query reports; each test sets the state it is about. */
const mockTaskQuery: {
  isPending: boolean;
  error: Error | null;
  data: unknown;
  refetch: jest.Mock;
} = {
  isPending: true,
  error: null,
  data: undefined,
  refetch: jest.fn(),
};

function task(): CleaningTask {
  return {
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    status: 'assigned',
    priority: 0,
    scheduled_date: '2026-11-10',
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
    guests_count: 4,
    started_at: null,
    completed_at: null,
    is_parallel: false,
    type: 'cleaning',
    notes: null,
    title: null,
    title_i18n: {},
  };
}

jest.mock('@/features/auth/session', () => ({
  useSession: () => mockSession,
}));

jest.mock('expo-router', () => ({
  Redirect: () => null,
  Stack: { Screen: () => null },
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b' }),
}));

/** The finish move: its mutate is where the queue of moves begins. */
const mockFinish = { isPending: false, error: null, submittedAt: 0, mutate: jest.fn() };

jest.mock('@/features/tasks/use-tasks', () => {
  const idle = () => ({ isPending: false, error: null, submittedAt: 0, mutate: jest.fn() });
  return {
    acceptVariables: jest.fn(),
    useTask: () => mockTaskQuery,
    useClaimTask: idle,
    useAcceptTask: idle,
    useStartTask: idle,
    useFinishTask: () => mockFinish,
  };
});

jest.mock('@/features/steps/use-steps', () => ({
  useTaskSteps: () => ({ data: undefined }),
}));

beforeEach(() => {
  mockSession.userId = null;
  mockSession.isLoading = true;
  mockSession.session = null;
  mockTaskQuery.isPending = true;
  mockTaskQuery.error = null;
  mockTaskQuery.data = undefined;
  mockTaskQuery.refetch.mockClear();
  mockFinish.mutate.mockClear();
});

test('opened before the session is read, it waits instead of saying the cleaning is gone', async () => {
  await render(<TaskRoute />);

  expect(screen.getByText('Загрузка…')).toBeTruthy();
  expect(screen.queryByText('Уборка не найдена или больше не ваша')).toBeNull();
});

// Nobody is known yet — a technician's push opens the app cold too — so the
// word is nobody's: not «Загружаем уборки…» to a man come to fix a boiler.
test('the wait before the session says a neutral word, not a cleaning', async () => {
  await render(<TaskRoute />);

  expect(screen.queryByText(/уборк|работ/i)).toBeNull();
});

describe('signed in', () => {
  beforeEach(() => {
    mockSession.userId = ME;
    mockSession.isLoading = false;
  });

  test('while the cleaning loads, its shape stands in for it, said as loading', async () => {
    await render(<TaskRoute />);

    const loading = screen.getByRole('progressbar', { name: 'Загружаем уборки…' });
    expect(loading.props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.queryByText('Уборка не найдена или больше не ваша')).toBeNull();
  });

  test('a cleaning that could not load says why in her words, the server’s small under it', async () => {
    // Arrange
    mockTaskQuery.isPending = false;
    mockTaskQuery.error = new Error('Network request failed');

    // Act
    await render(<TaskRoute />);

    // Assert
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });

  test('a cleaning that never loaded is titled, and «Повторить» asks again', async () => {
    // Arrange
    mockTaskQuery.isPending = false;
    mockTaskQuery.error = new Error('Network request failed');

    // Act
    await render(<TaskRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    // Assert
    expect(screen.getByText('Не удалось загрузить уборки')).toBeTruthy();
    expect(mockTaskQuery.refetch).toHaveBeenCalledTimes(1);
  });

  test('a refresh that failed keeps the cleaning on screen, the failure said above it', async () => {
    // Arrange: TanStack keeps the last data when a background refetch fails.
    mockTaskQuery.isPending = false;
    mockTaskQuery.error = new Error('Network request failed');
    mockTaskQuery.data = task();

    // Act
    await render(<TaskRoute />);

    // Assert: the cleaning and its button are still there.
    expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Начать уборку' })).toBeTruthy();
    // No pull-to-refresh on this screen, so not the lists' «pull down».
    expect(screen.getByText('Не удалось обновить, показаны сохранённые данные.')).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });

  test('a cleaning that is not hers any more says so', async () => {
    mockTaskQuery.isPending = false;
    mockTaskQuery.data = null;

    await render(<TaskRoute />);

    expect(screen.getByText('Уборка не найдена или больше не ваша')).toBeTruthy();
  });
});

/** A job of hers under way: the moment a report or a request makes sense. */
function running(type: CleaningTask['type']): CleaningTask {
  return {
    ...task(),
    type,
    reservation_id: null,
    status: 'in_progress',
    started_at: '2026-11-10T08:05:00+00:00',
  };
}

describe('the role decides what the job offers', () => {
  beforeEach(() => {
    mockSession.userId = ME;
    mockSession.isLoading = false;
    mockTaskQuery.isPending = false;
  });

  afterEach(async () => {
    await setWordContext(undefined);
  });

  test('a cleaner raises a task and asks for supplies from her cleaning', async () => {
    mockSession.session = { user: { app_metadata: { role: 'cleaner' } } };
    mockTaskQuery.data = running('cleaning');

    await render(<TaskRoute />);

    expect(screen.getByRole('button', { name: 'Создать задание' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Запросить расходники' })).toBeTruthy();
  });

  // No «Расходники» for a technician (docs/tech-plan.md §0, §4): a request he
  // sent from here would land in a tab he does not have.
  test.each(['tech', 'head_tech'])(
    'a %s raises a task from his repair, and is offered no supplies',
    async (role) => {
      mockSession.session = { user: { app_metadata: { role } } };
      await setWordContext('tech');
      mockTaskQuery.data = running('maintenance');

      await render(<TaskRoute />);

      expect(screen.getByRole('button', { name: 'Создать задание' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Запросить расходники' })).toBeNull();
      expect(screen.queryByText(/расходник/i)).toBeNull();
    },
  );

  test('a technician’s job loads, and goes missing, in his words', async () => {
    mockSession.session = { user: { app_metadata: { role: 'tech' } } };
    await setWordContext('tech');
    mockTaskQuery.isPending = true;

    await render(<TaskRoute />);

    expect(screen.getByRole('progressbar', { name: 'Загружаем работы…' })).toBeTruthy();

    mockTaskQuery.isPending = false;
    mockTaskQuery.data = null;
    await render(<TaskRoute />);

    expect(screen.getByText('Работа не найдена или больше не ваша')).toBeTruthy();
  });
});

// The question comes before the move (owner, 2026-10-10): only «Завершить»
// hands the finish to the queue of moves — the same mutate as before, which
// keeps a finish made without signal until the signal returns.
describe('the finish is asked about before it is queued', () => {
  beforeEach(() => {
    mockSession.userId = ME;
    mockSession.isLoading = false;
    mockSession.session = { user: { app_metadata: { role: 'cleaner' } } };
    mockTaskQuery.isPending = false;
    mockTaskQuery.data = running('cleaning');
  });

  test('nothing is queued until «Завершить», then one finish of this cleaning', async () => {
    await render(<TaskRoute />);

    await fireEvent.press(screen.getByRole('button', { name: 'Завершить уборку' }));
    expect(mockFinish.mutate).not.toHaveBeenCalled();

    const yes = screen.getByRole('button', { name: 'Завершить' });
    await fireEvent.press(yes);
    await fireEvent.press(yes);

    expect(mockFinish.mutate).toHaveBeenCalledTimes(1);
    expect(mockFinish.mutate).toHaveBeenCalledWith('3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b');
  });

  test('«Отмена» queues nothing', async () => {
    await render(<TaskRoute />);

    await fireEvent.press(screen.getByRole('button', { name: 'Завершить уборку' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отмена' }));

    expect(mockFinish.mutate).not.toHaveBeenCalled();
  });

  test('while the finish waits in the queue, its button is held and asks nothing', async () => {
    mockFinish.isPending = true;
    try {
      await render(<TaskRoute />);

      await fireEvent.press(screen.getByRole('button', { name: 'Завершить уборку' }));

      expect(screen.queryByRole('button', { name: 'Отмена' })).toBeNull();
      expect(mockFinish.mutate).not.toHaveBeenCalled();
    } finally {
      mockFinish.isPending = false;
    }
  });
});
