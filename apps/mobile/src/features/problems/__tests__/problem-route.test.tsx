import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import ProblemRoute from '@/app/problem/[id]';

import type { Problem } from '../schema';

/**
 * One report, wired. Who may do what is decided here: the reporter changes an
 * open report and adds photos to it, a technician opens the work that fixes it,
 * anyone who sees it may talk about it. The screen's own states — loading, a
 * failure, a report that is not there — are this route's too.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SOMEONE_ELSE = '8d0f7780-8536-41ef-a55c-f18e2a01ab08';
const PROBLEM_ID = 'd1e2f3a4-1111-4111-8111-d1e2f3a40001';
const FIX_TASK = 'b1c2d3e4-2222-4222-8222-b1c2d3e40001';

const mockSession = {
  userId: ME as string | null,
  session: { user: { app_metadata: { role: 'cleaner' as string } } },
};
const mockProblemQuery: {
  isPending: boolean;
  error: Error | null;
  data: Problem | null | undefined;
  refetch: jest.Mock;
} = { isPending: false, error: null, data: undefined, refetch: jest.fn() };
let mockGalleryAllowed = false;

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001' }),
}));

jest.mock('@/features/auth/session', () => ({ useSession: () => mockSession }));

jest.mock('@/features/problems/use-problems', () => ({ useProblem: () => mockProblemQuery }));

// The head technician's part of the screen reads the task as the board does.
jest.mock('@/features/board/use-board', () => {
  const idle = () => ({ mutate: jest.fn(), reset: jest.fn(), isPending: false, error: null });
  return {
    useBoardProblem: () => ({
      data: {
        id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001',
        property_id: 412432,
        title: 'Кран течёт',
        priority: 'normal',
        status: 'open',
        archived_at: null,
        created_at: '2026-11-10T08:00:00+00:00',
        property: null,
        fix_tasks: [],
      },
      error: null,
      // Read from the server since the screen opened: the moves are offered.
      isFetchedAfterMount: true,
      refetch: jest.fn(),
    }),
    useStaffDirectory: () => ({ data: [], error: null, refetch: jest.fn() }),
    useAssignProblem: idle,
    useUnassignProblem: idle,
    useDispatchInFlight: () => ({ isMoving: false, isMovingNow: () => false }),
  };
});

jest.mock('@/features/host/use-host', () => ({ useGalleryAllowed: () => mockGalleryAllowed }));

jest.mock('@/features/media/capture', () => ({
  capturePhoto: jest.fn(),
  pickPhotoFromGallery: jest.fn(),
}));

jest.mock('@/features/media/use-media', () => {
  const idle = () => ({ mutate: jest.fn(), error: null });
  return {
    mediaItemViews: () => [],
    useAttachMedia: idle,
    useRemoveMedia: idle,
    useRememberLocalMedia: () => jest.fn(),
    useLocalMedia: () => ({ data: {} }),
    useMediaUrls: () => ({ data: {} }),
    useProblemMedia: () => ({ data: [] }),
    useUploadingMediaIds: () => new Set(),
  };
});

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: PROBLEM_ID,
    property_id: 412432,
    task_id: null,
    reported_by: ME,
    title: 'Кран течёт',
    description: null,
    priority: 'normal',
    status: 'open',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-11-10T08:00:00+00:00',
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
    fix_tasks: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.userId = ME;
  mockSession.session.user.app_metadata.role = 'cleaner';
  mockProblemQuery.isPending = false;
  mockProblemQuery.error = null;
  mockProblemQuery.data = problem();
  mockGalleryAllowed = false;
});

describe('who may do what', () => {
  test('her own open report: she may change it, and «Изменить» opens the form', async () => {
    await render(<ProblemRoute />);

    await fireEvent.press(screen.getByRole('button', { name: 'Изменить' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/problem/[id]/edit',
      params: { id: PROBLEM_ID },
    });
    expect(screen.getByRole('button', { name: 'Снять фото' })).toBeTruthy();
  });

  test.each(['assigned', 'in_progress', 'resolved', 'cancelled'] as const)(
    'her own report once %s is no longer hers to change',
    async (status) => {
      mockProblemQuery.data = problem({ status });

      await render(<ProblemRoute />);

      expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Снять фото' })).toBeNull();
    },
  );

  test('somebody else’s open report is read only', async () => {
    mockProblemQuery.data = problem({ reported_by: SOMEONE_ELSE });

    await render(<ProblemRoute />);

    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(screen.getByText('Фото нет')).toBeTruthy();
  });

  test('the gallery is offered beside the camera only where the company allows it', async () => {
    mockGalleryAllowed = true;

    await render(<ProblemRoute />);

    expect(screen.getByRole('button', { name: 'Выбрать фото из галереи' })).toBeTruthy();
  });

  test('without the company’s word there is the camera alone', async () => {
    await render(<ProblemRoute />);

    expect(screen.queryByRole('button', { name: 'Выбрать фото из галереи' })).toBeNull();
  });

  test('the technician’s own live fix task opens from the report', async () => {
    mockProblemQuery.data = problem({
      reported_by: SOMEONE_ELSE,
      status: 'in_progress',
      fix_tasks: [{ id: FIX_TASK, assignee_id: ME, status: 'in_progress' }],
    });

    await render(<ProblemRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Открыть работу техника' }));

    expect(router.push).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: FIX_TASK } });
  });

  test('a fix task that is someone else’s, or cancelled, is not offered', async () => {
    mockProblemQuery.data = problem({
      status: 'assigned',
      fix_tasks: [
        { id: FIX_TASK, assignee_id: SOMEONE_ELSE, status: 'assigned' },
        { id: 'c1c2d3e4-3333-4333-8333-c1c2d3e40001', assignee_id: ME, status: 'cancelled' },
      ],
    });

    await render(<ProblemRoute />);

    expect(screen.queryByRole('button', { name: 'Открыть работу техника' })).toBeNull();
  });

  test('the chat of the report is always one press away', async () => {
    mockProblemQuery.data = problem({ reported_by: SOMEONE_ELSE, status: 'resolved' });

    await render(<ProblemRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Чат' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/chat/[subject]/[id]',
      params: { subject: 'problem', id: PROBLEM_ID },
    });
  });
});

// Brief, item 2: the head technician hands an open task out and takes the
// person off a repair, and opens its history; a technician and a cleaner see
// none of it. Cancelling, closing and the archive are the manager's, on no
// phone at all.
describe('the head technician’s part, by role', () => {
  const DISPATCH = ['Назначить', 'Снять с работы', 'История'];
  const MANAGERS = ['Отменить', 'Закрыть', 'В архив', 'Выполнено'];

  test('the head technician gets «Назначить» and the history', async () => {
    mockSession.session.user.app_metadata.role = 'head_tech';
    mockProblemQuery.data = problem({ reported_by: SOMEONE_ELSE });

    await render(<ProblemRoute />);

    expect(screen.getByRole('button', { name: 'Назначить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'История' })).toBeTruthy();
    for (const name of MANAGERS) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  test.each(['tech', 'cleaner'])('a %s sees none of it', async (role) => {
    mockSession.session.user.app_metadata.role = role;

    await render(<ProblemRoute />);

    expect(screen.getByText('Кран течёт')).toBeTruthy();
    for (const name of DISPATCH) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});

describe('the screen’s states', () => {
  test('before she is known, the report is not found', async () => {
    mockSession.userId = null;

    await render(<ProblemRoute />);

    expect(screen.getByText('Задание не найдено')).toBeTruthy();
  });

  test('a report that is not there says so', async () => {
    mockProblemQuery.data = null;

    await render(<ProblemRoute />);

    expect(screen.getByText('Задание не найдено')).toBeTruthy();
  });

  test('a report that could not load says why in her words, the server’s small under it', async () => {
    mockProblemQuery.data = undefined;
    mockProblemQuery.error = new Error('Network request failed');

    await render(<ProblemRoute />);

    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });

  test('a report that never loaded is titled, and «Повторить» asks again', async () => {
    // Arrange
    mockProblemQuery.data = undefined;
    mockProblemQuery.error = new Error('Network request failed');

    // Act
    await render(<ProblemRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    // Assert: there is no «could not load the report» of its own; the general one.
    expect(screen.getByText('Не удалось показать экран. Попробуйте ещё раз.')).toBeTruthy();
    expect(mockProblemQuery.refetch).toHaveBeenCalledTimes(1);
  });

  test('a refresh that failed keeps the report on screen, the failure said above it', async () => {
    // Arrange: TanStack keeps the last data when a background refetch fails.
    mockProblemQuery.error = new Error('Network request failed');

    // Act
    await render(<ProblemRoute />);

    // Assert
    expect(screen.getByText('Кран течёт')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeTruthy();
    expect(screen.getByText('Не удалось обновить, показаны сохранённые данные.')).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });

  test('while the report loads, its shape stands in for it, said as loading', async () => {
    mockProblemQuery.isPending = true;
    mockProblemQuery.data = undefined;

    await render(<ProblemRoute />);

    const loading = screen.getByRole('progressbar', { name: 'Загружаем задания…' });
    expect(loading.props.accessibilityState).toMatchObject({ busy: true });
  });
});
