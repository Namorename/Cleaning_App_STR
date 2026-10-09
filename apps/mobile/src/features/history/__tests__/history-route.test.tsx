import { fireEvent, render, screen } from '@testing-library/react-native';

import ProblemHistoryRoute from '@/app/problem/[id]/history';
import { formatReportedAt } from '@/features/problems/format';
import { HEAD_TECH, PROBLEM_ID, REPAIR_ID, STAFF, TECH_IVAN } from '@/testing/board-fixtures';

import type { ProblemEvent } from '../schema';
import { useProblemEvents } from '../use-history';

/**
 * A task's history (brief, item 3): the head technician's screen — the
 * manager does not use the phone. The journal oldest first, each line who did
 * what and when, names from the directory, dates in the phone's language. The
 * journal began with the rollout (docs/tech-plan.md §3.1): a task older than
 * that says where its history starts. A technician and a cleaner have no
 * history to open: the server would give them nothing, and the screen says
 * the task is not theirs to see.
 */

/** The role in his token; the head technician unless a test says otherwise. */
let mockRole = 'head_tech';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001' }),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    isLoading: false,
    session: { user: { app_metadata: { role: mockRole } } },
  }),
}));

jest.mock('../use-history', () => ({ useProblemEvents: jest.fn() }));

jest.mock('@/features/board/use-board', () => ({
  useStaffDirectory: () => ({ data: mockStaff, error: null, refetch: jest.fn() }),
}));

const mockStaff = STAFF;

function event(id: number, kind: string, extra: Partial<ProblemEvent> = {}): ProblemEvent {
  return {
    id,
    problem_id: PROBLEM_ID,
    task_id: REPAIR_ID,
    kind,
    actor_id: HEAD_TECH,
    created_at: `2026-10-0${id}T08:05:00+00:00`,
    params: {},
    ...extra,
  };
}

const STORY = [
  event(5, 'reported', { task_id: null, actor_id: TECH_IVAN }),
  event(6, 'assigned', { params: { to: TECH_IVAN, date: '2026-10-07' } }),
  event(7, 'taken_off', {
    params: { assignee: TECH_IVAN, cause: 'account_disabled' },
    actor_id: null,
  }),
];

type EventsAnswer = ReturnType<typeof useProblemEvents>;

function answer(overrides: Partial<EventsAnswer> = {}): void {
  jest.mocked(useProblemEvents).mockReturnValue({
    data: STORY,
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
    ...overrides,
  } as EventsAnswer);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'head_tech';
  answer();
});

describe('the head technician', () => {
  test('reads the story oldest first: who, what, when', async () => {
    await render(<ProblemHistoryRoute />);

    const lines = screen
      .getAllByTestId('history-line')
      .map((line) => line.props.accessibilityLabel as string);
    expect(lines).toEqual([
      `Иван Петров. Задание заведено. ${formatReportedAt(STORY[0].created_at)}`,
      `Сергей Главный. Назначено: Иван Петров · ср, 7 октября. ${formatReportedAt(STORY[1].created_at)}`,
      `Сотрудник. Иван Петров: работа снята — учётка отключена. ${formatReportedAt(STORY[2].created_at)}`,
    ]);
  });

  test('each part is drawn, the person first', async () => {
    await render(<ProblemHistoryRoute />);

    expect(screen.getByText('Назначено: Иван Петров · ср, 7 октября')).toBeTruthy();
    expect(screen.getByText(formatReportedAt(STORY[1].created_at))).toBeTruthy();
    expect(screen.getAllByText('Сергей Главный')).toHaveLength(1);
  });

  test('a history that begins with the report needs no note', async () => {
    await render(<ProblemHistoryRoute />);

    expect(screen.queryByText(/История начинается/)).toBeNull();
  });

  test('a task older than the journal says where its history starts', async () => {
    answer({ data: STORY.slice(1) });

    await render(<ProblemHistoryRoute />);

    expect(screen.getByText('История начинается с 3 октября 2026 г.')).toBeTruthy();
  });

  test('nothing in the journal is the empty state, with the same note', async () => {
    answer({ data: [] });

    await render(<ProblemHistoryRoute />);

    expect(screen.getByText('Событий пока нет')).toBeTruthy();
    expect(screen.getByText('История начинается с 3 октября 2026 г.')).toBeTruthy();
  });

  test('while it loads, its shape stands in, said as loading', async () => {
    answer({ data: undefined, isPending: true });

    await render(<ProblemHistoryRoute />);

    expect(screen.getByRole('progressbar', { name: 'Загружаем историю…' })).toBeTruthy();
  });

  test('a history that cannot load says why, and «Повторить» asks again', async () => {
    const refetch = jest.fn();
    answer({ data: undefined, error: new Error('Network request failed'), refetch });

    await render(<ProblemHistoryRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(refetch).toHaveBeenCalled();
  });
});

describe('anybody else', () => {
  test.each(['tech', 'cleaner'])('a %s has no history to open', async (role) => {
    mockRole = role;

    await render(<ProblemHistoryRoute />);

    expect(screen.getByText('Задание не найдено')).toBeTruthy();
    expect(useProblemEvents).not.toHaveBeenCalled();
  });
});
