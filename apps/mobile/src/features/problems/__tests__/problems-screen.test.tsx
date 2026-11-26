import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet, type ViewStyle } from 'react-native';

import ProblemsScreen from '@/app/(tabs)/problems';
import { BUTTON_HEIGHT, Colors, FontSize } from '@/constants/theme';
import { calendarDay } from '@/features/tasks/schema';

import type { Problem } from '../schema';
import { useMyProblems } from '../use-problems';

/**
 * Her reports, wired. «Создать задание» was the first row of the list and
 * scrolled away with it (docs/design/redesign-directions.html, `pproblems`);
 * now it is one 56 dp button pinned under the list, above the tab bar.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set(), problems: new Set(), refetch: jest.fn() }),
}));

jest.mock('../use-problems', () => ({ useMyProblems: jest.fn() }));

// The head technician's tab is the board of every task (features/board).
jest.mock('@/features/board/use-board', () => ({
  useBoardProblems: () => ({
    data: [
      {
        id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40009',
        property_id: 412432,
        title: 'Сломан замок у соседей',
        priority: 'normal',
        status: 'open',
        archived_at: null,
        created_at: '2026-11-10T08:00:00+00:00',
        property: null,
        fix_tasks: [],
      },
    ],
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
  }),
  useBoardCut: () => ({ isOpenCut: false, isClosedCut: false }),
  // The archive is read only once «Архив» is chosen: nothing held yet.
  useBoardArchive: () => ({
    data: undefined,
    isPending: true,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
  }),
  useStaffDirectory: () => ({ data: [], error: null, refetch: jest.fn() }),
}));

/** The role in her token; a cleaner unless a test says otherwise. */
let mockRole = 'cleaner';

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    isLoading: false,
    session: { user: { app_metadata: { role: mockRole } } },
  }),
}));

const REPORT = 'Создать задание';

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001',
    property_id: 412432,
    task_id: null,
    reported_by: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    title: 'Кран течёт',
    description: null,
    priority: 'normal',
    status: 'open',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-11-10T08:00:00+00:00',
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
    ...overrides,
  } as Problem;
}

type ListAnswer = ReturnType<typeof useMyProblems>;

function answer(overrides: Partial<ListAnswer>): void {
  jest.mocked(useMyProblems).mockReturnValue({
    data: [problem()],
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
    ...overrides,
  } as ListAnswer);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'cleaner';
  answer({});
});

// A technician has no listings to report on from here: he raises a task from
// his repair, where its listing fills itself in (docs/tech-plan.md §4). The
// list itself stays — what it holds is the server's to decide. The head
// technician has no button either, and instead of a list, the board.
describe('the role decides the button', () => {
  test('a technician gets his list without «Создать задание», and no board', async () => {
    mockRole = 'tech';

    await render(<ProblemsScreen />);

    expect(screen.getByText('Кран течёт')).toBeTruthy();
    expect(screen.queryByRole('button', { name: REPORT })).toBeNull();
    expect(screen.queryByText('Сломан замок у соседей')).toBeNull();
    expect(screen.queryByLabelText('Статус')).toBeNull();
  });

  // Every task of the company with its filters (docs/tech-plan.md §4), not
  // the list of his own: brief, item 1.
  test('the head technician gets the board of every task, with its filters', async () => {
    mockRole = 'head_tech';

    await render(<ProblemsScreen />);

    expect(screen.getByText('Сломан замок у соседей')).toBeTruthy();
    expect(screen.getByLabelText('Статус').props.accessibilityRole).toBe('tablist');
    expect(screen.getByRole('button', { name: 'Исполнитель: Все исполнители' })).toBeTruthy();
    expect(screen.queryByText('Кран течёт')).toBeNull();
    expect(screen.queryByRole('button', { name: REPORT })).toBeNull();
    expect(useMyProblems).not.toHaveBeenCalled();
  });

  test.each(['cleaner', 'auditor'])('a %s keeps «Создать задание», and no board', async (role) => {
    mockRole = role;

    await render(<ProblemsScreen />);

    expect(screen.getByRole('button', { name: REPORT })).toBeTruthy();
    expect(screen.queryByText('Сломан замок у соседей')).toBeNull();
  });

  // The office runs the company from the phone (owner, 2026-11-18): the head
  // technician's board, and «Создать задание» it had on the phone before.
  test.each(['manager', 'admin'])(
    'a %s gets the board of every task, and keeps «Создать задание»',
    async (role) => {
      mockRole = role;

      await render(<ProblemsScreen />);

      expect(screen.getByText('Сломан замок у соседей')).toBeTruthy();
      expect(screen.getByLabelText('Статус').props.accessibilityRole).toBe('tablist');
      expect(screen.queryByText('Кран течёт')).toBeNull();
      expect(useMyProblems).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('button', { name: REPORT }));
      expect(router.push).toHaveBeenCalledWith('/problem/new');
    },
  );
});

test('«Создать задание» is a 56 dp button that starts a report', async () => {
  await render(<ProblemsScreen />);

  const button = screen.getByRole('button', { name: REPORT });
  expect((StyleSheet.flatten(button.props.style) as ViewStyle).minHeight).toBe(BUTTON_HEIGHT);
  await fireEvent.press(button);

  expect(router.push).toHaveBeenCalledWith('/problem/new');
});

test('the button is not a row of the list, so it does not scroll away', async () => {
  await render(<ProblemsScreen />);

  // The list's own scroll view, as the renderer draws it.
  const [list] = screen.container.queryAll((node) => node.type === 'RCTScrollView');
  expect(within(list).getByText('Кран течёт')).toBeTruthy();
  expect(within(list).queryByRole('button', { name: REPORT })).toBeNull();
  expect(screen.getByRole('button', { name: REPORT })).toBeTruthy();
});

test('while the list loads she can already start a report', async () => {
  answer({ data: undefined, isPending: true });

  await render(<ProblemsScreen />);

  // Said as loading: the label of the skeleton that stands in.
  expect(screen.getByRole('progressbar', { name: 'Загружаем задания…' })).toBeTruthy();
  expect(screen.getByRole('button', { name: REPORT })).toBeTruthy();
});

test('a list that cannot load keeps its retry, and the button stays under it', async () => {
  answer({ data: undefined, error: new Error('Network request failed') });

  await render(<ProblemsScreen />);

  expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  expect(screen.getByRole('button', { name: REPORT })).toBeTruthy();
});

test('an empty list still says so', async () => {
  answer({ data: [] });

  await render(<ProblemsScreen />);

  expect(screen.getByText('Заданий не заявлено')).toBeTruthy();
  expect(screen.getByRole('button', { name: REPORT })).toBeTruthy();
});

describe('on the «Абрикос» components', () => {
  test('while the list loads, its shape stands in for it, said as loading', async () => {
    answer({ data: undefined, isPending: true });

    await render(<ProblemsScreen />);

    const loading = screen.getByRole('progressbar', { name: 'Загружаем задания…' });
    expect(loading.props.accessibilityState).toMatchObject({ busy: true });
  });

  test('an empty list is the empty state, titled', async () => {
    answer({ data: [] });

    await render(<ProblemsScreen />);

    const empty = StyleSheet.flatten(screen.getByText('Заданий не заявлено').props.style);
    expect(empty.fontSize).toBe(FontSize.title);
  });

  test('closed reports stand under their heading, drawn as a caption', async () => {
    answer({
      data: [
        problem(),
        problem({ id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40002', status: 'resolved' }),
      ],
    });

    await render(<ProblemsScreen />);

    const heading = StyleSheet.flatten(screen.getByText('Закрытые').props.style);
    expect(heading.fontSize).toBe(FontSize.caption);
    expect(heading.color).toBe(Colors.light.textSecondary);
  });
});

// The owner, 2026-11-26: a technician's «Мои задания» is his queue — the planned day, else the
// day made; then the level; then the older first — and what is planned after today waits under
// «Запланировано». A cleaner's reports keep the order of before.
describe('the technician’s queue', () => {
  const id = (n: number) => `d1e2f3a4-1111-4111-8111-${String(n).padStart(12, '0')}`;
  const SHOWN = /^(Срочное|Старше|Новее|Запланировано|На завтра|Закрытые|Закрыто)$/;
  const shown = () => screen.getAllByText(SHOWN).map((node) => node.props.children);

  beforeEach(() => {
    answer({
      // As the server reads them: newest reported first.
      data: [
        problem({
          id: id(11),
          title: 'На завтра',
          created_at: '2026-11-22T08:00:00+00:00',
          due_on: calendarDay(new Date(), 1),
        }),
        problem({
          id: id(12),
          title: 'Срочное',
          created_at: '2026-11-21T08:00:00+00:00',
          priority: 'high',
        }),
        problem({ id: id(13), title: 'Новее', created_at: '2026-11-20T10:00:00+00:00' }),
        problem({ id: id(14), title: 'Старше', created_at: '2026-11-20T08:00:00+00:00' }),
        problem({ id: id(15), title: 'Закрыто', status: 'resolved' }),
      ],
    });
  });

  test('his live tasks by day, level and age; those planned after today under their heading', async () => {
    mockRole = 'tech';

    await render(<ProblemsScreen />);

    expect(shown()).toEqual([
      'Старше',
      'Новее',
      'Срочное',
      'Запланировано',
      'На завтра',
      'Закрытые',
      'Закрыто',
    ]);
    expect(screen.getByText('Запланировано').props.accessibilityRole).toBe('header');
    expect(screen.getByText('Дата: Завтра')).toBeTruthy();
  });

  test('a cleaner’s reports stay newest first, with no planned heading', async () => {
    await render(<ProblemsScreen />);

    expect(shown()).toEqual(['На завтра', 'Срочное', 'Новее', 'Старше', 'Закрытые', 'Закрыто']);
  });
});
