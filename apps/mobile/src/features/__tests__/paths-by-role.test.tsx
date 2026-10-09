import { render, screen } from '@testing-library/react-native';

import ProblemsScreen from '@/app/(tabs)/problems';
import ProblemRoute from '@/app/problem/[id]';
import ProblemHistoryRoute from '@/app/problem/[id]/history';
import {
  useAssignProblem,
  useBoardArchive,
  useBoardProblem,
  useBoardProblems,
  useStaffDirectory,
  useUnassignProblem,
} from '@/features/board/use-board';
import { useProblemEvents } from '@/features/history/use-history';
import type { Problem } from '@/features/problems/schema';
import {
  HEAD_TECH,
  PROBLEM_ID,
  REPAIR_ID,
  STAFF,
  TECH_IVAN,
  boardProblem,
  repair,
} from '@/testing/board-fixtures';

/**
 * The head technician's paths, and everybody else's, end to end over the
 * screens (brief, item 4; docs/tech-plan.md §3–§4), as the cleaner's own paths
 * are walked: the «Задания» tab, a task's screen, its history.
 *
 * - The head technician: the board of every task with its filters; on a task
 *   «Назначить» while it waits, «Снять с работы» while somebody holds it, and
 *   its history.
 * - A technician: his own tasks only — no board, no hand-out, no history.
 * - A cleaner: nothing of this.
 * - Nobody: the manager's levers — cancel, close, archive.
 *
 * Only what is offered follows the role; what anybody reads is RLS's. So for
 * a technician and a cleaner the board, the directory and the journal are not
 * even asked for.
 */

let mockRole = 'head_tech';
let mockUserId = HEAD_TECH;

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001' }),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: mockUserId,
    isLoading: false,
    session: { user: { app_metadata: { role: mockRole } } },
  }),
}));

jest.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set(), problems: new Set(), refetch: jest.fn() }),
}));

/** The task as her own list and its screen read it. */
const mockOwn = {
  problem: undefined as unknown as Problem,
};

jest.mock('@/features/problems/use-problems', () => ({
  useMyProblems: () => ({
    data: [mockOwn.problem],
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
  }),
  useProblem: () => ({ data: mockOwn.problem, isPending: false, error: null, refetch: jest.fn() }),
}));

jest.mock('@/features/board/use-board', () => {
  const idle = () => ({ mutate: jest.fn(), reset: jest.fn(), isPending: false, error: null });
  return {
    useBoardProblems: jest.fn(),
    useBoardCut: jest.fn(() => ({ isOpenCut: false, isClosedCut: false })),
    // The archive is read only once «Архив» is chosen: nothing held yet.
    useBoardArchive: jest.fn(() => ({
      data: undefined,
      isPending: true,
      error: null,
      refetch: jest.fn(),
      isRefetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
    })),
    useBoardProblem: jest.fn(),
    useStaffDirectory: jest.fn(),
    useAssignProblem: jest.fn(idle),
    useUnassignProblem: jest.fn(idle),
    useDispatchInFlight: jest.fn(() => ({ isMoving: false, isMovingNow: () => false })),
  };
});

jest.mock('@/features/history/use-history', () => ({ useProblemEvents: jest.fn() }));

jest.mock('@/features/host/use-host', () => ({ useGalleryAllowed: () => false }));

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

const OTHERS_TASK = 'Сломан замок у соседей';
/**
 * What anybody has on the screen of a task he reported: its edit while it is
 * open, a photo, the conversation. Nothing of the office: no cancel, no close,
 * no archive.
 */
const FIELD = ['Изменить', 'Снять фото', 'Чат'];

function ownProblem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: PROBLEM_ID,
    property_id: 412432,
    task_id: null,
    reported_by: mockUserId,
    title: 'Кран течёт',
    description: null,
    priority: 'normal',
    status: 'open',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-10-05T08:00:00+00:00',
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
    fix_tasks: [],
    ...overrides,
  };
}

function boardHolds(task: ReturnType<typeof boardProblem>): void {
  jest.mocked(useBoardProblem).mockReturnValue({
    data: task,
    error: null,
    isFetchedAfterMount: true,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useBoardProblem>);
}

function asRole(role: string, userId = HEAD_TECH): void {
  mockRole = role;
  mockUserId = userId;
  mockOwn.problem = ownProblem();
}

beforeEach(() => {
  jest.clearAllMocks();
  asRole('head_tech');
  jest.mocked(useBoardProblems).mockReturnValue({
    data: [boardProblem({ id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40009', title: OTHERS_TASK })],
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
  } as unknown as ReturnType<typeof useBoardProblems>);
  boardHolds(boardProblem());
  jest.mocked(useStaffDirectory).mockReturnValue({
    data: STAFF,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useStaffDirectory>);
  jest.mocked(useProblemEvents).mockReturnValue({
    data: [
      {
        id: 1,
        problem_id: PROBLEM_ID,
        task_id: null,
        kind: 'reported',
        actor_id: TECH_IVAN,
        created_at: '2026-10-05T08:00:00+00:00',
        params: {},
      },
    ],
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
  } as unknown as ReturnType<typeof useProblemEvents>);
});

/**
 * Every button on screen, by name: the whole set rather than a list of what
 * must be missing, so a lever of the manager's is caught whatever it is called.
 */
function buttons(): string[] {
  return screen
    .getAllByRole('button')
    .map((button) => button.props.accessibilityLabel as string)
    .sort();
}

describe('the head technician', () => {
  test('«Задания» is the board of every task, with both filters', async () => {
    await render(<ProblemsScreen />);

    expect(screen.getByText(OTHERS_TASK)).toBeTruthy();
    expect(screen.getByLabelText('Статус').props.accessibilityRole).toBe('tablist');
    expect(screen.getByRole('tab', { name: 'Архив' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Исполнитель: Все исполнители' })).toBeTruthy();
  });

  test('a waiting task offers «Назначить» and its history, nothing of the manager’s', async () => {
    await render(<ProblemRoute />);

    expect(buttons()).toEqual([...FIELD, 'История', 'Назначить'].sort());
  });

  test('a held task offers «Снять с работы» instead', async () => {
    boardHolds(boardProblem({ status: 'assigned', fix_tasks: [repair()] }));

    await render(<ProblemRoute />);

    expect(buttons()).toEqual([...FIELD, 'История', 'Снять с работы'].sort());
  });

  test('the history is his to read', async () => {
    await render(<ProblemHistoryRoute />);

    expect(screen.getByText('Задание заведено')).toBeTruthy();
    expect(screen.getByText('Иван Петров')).toBeTruthy();
  });
});

describe.each([
  ['a technician', 'tech', TECH_IVAN],
  ['a cleaner', 'cleaner', '7c9e6679-0000-4000-8000-00000000c1ea'],
])('%s', (_who, role, userId) => {
  beforeEach(() => {
    asRole(role, userId);
  });

  test('«Задания» is his own list: no board, no filters', async () => {
    await render(<ProblemsScreen />);

    expect(screen.getByText('Кран течёт')).toBeTruthy();
    expect(screen.queryByText(OTHERS_TASK)).toBeNull();
    expect(screen.queryByLabelText('Статус')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Исполнитель:/ })).toBeNull();
  });

  test('a task’s screen offers no hand-out, no take-off, no history', async () => {
    await render(<ProblemRoute />);

    expect(screen.getByText('Кран течёт')).toBeTruthy();
    expect(buttons()).toEqual(FIELD);
  });

  test('the history route is not his', async () => {
    await render(<ProblemHistoryRoute />);

    expect(screen.getByText('Задание не найдено')).toBeTruthy();
  });

  test('the board, the names and the journal are never asked for', async () => {
    await render(<ProblemsScreen />);
    await render(<ProblemRoute />);
    await render(<ProblemHistoryRoute />);

    expect(useBoardProblems).not.toHaveBeenCalled();
    expect(useBoardArchive).not.toHaveBeenCalled();
    expect(useBoardProblem).not.toHaveBeenCalled();
    expect(useStaffDirectory).not.toHaveBeenCalled();
    expect(useProblemEvents).not.toHaveBeenCalled();
    expect(useAssignProblem).not.toHaveBeenCalled();
    expect(useUnassignProblem).not.toHaveBeenCalled();
  });
});

test('a technician still opens his own repair from the task', async () => {
  asRole('tech', TECH_IVAN);
  mockOwn.problem = ownProblem({
    reported_by: HEAD_TECH,
    status: 'assigned',
    fix_tasks: [{ id: REPAIR_ID, assignee_id: TECH_IVAN, status: 'assigned' }],
  });

  await render(<ProblemRoute />);

  expect(buttons()).toEqual(['Открыть работу техника', 'Чат']);
});
