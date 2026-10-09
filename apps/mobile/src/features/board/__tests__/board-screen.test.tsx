import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useUnreadSubjects } from '@/features/chat/use-chat';
import {
  CLEANER_ANNA,
  STAFF,
  TECH_IVAN,
  TECH_OLGA,
  boardProblem,
  repair,
} from '@/testing/board-fixtures';

import { BoardScreen } from '../board-screen';
import type { BoardProblem } from '../schema';
import { useBoardArchive, useBoardProblems, useStaffDirectory } from '../use-board';

/**
 * The head technician's «Задания» (brief, item 1): every task of the company
 * as a card, filtered by status — the archive a filter of its own, read only
 * when he asks for it, a page at a time — and by who holds the live repair,
 * chosen on a sheet. Loading, empty and failure are the components' own states.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: jest.fn(() => ({
    tasks: new Set(),
    problems: new Set(),
    refetch: jest.fn(),
  })),
}));

jest.mock('../use-board', () => ({
  useBoardProblems: jest.fn(),
  useBoardArchive: jest.fn(),
  useStaffDirectory: jest.fn(),
}));

const OPEN = boardProblem({ id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001', title: 'Кран течёт' });
const IVANS = boardProblem({
  id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40002',
  title: 'Нет горячей воды',
  status: 'assigned',
  fix_tasks: [repair()],
});
const OLGAS = boardProblem({
  id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40003',
  title: 'Сломан замок',
  status: 'in_progress',
  fix_tasks: [repair({ assignee_id: TECH_OLGA, status: 'in_progress' })],
});
const ANNAS = boardProblem({
  id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40004',
  title: 'Перегорела лампа',
  status: 'assigned',
  fix_tasks: [repair({ assignee_id: CLEANER_ANNA })],
});
const RESOLVED = boardProblem({
  id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40005',
  title: 'Скрипит дверь',
  status: 'resolved',
  fix_tasks: [repair({ status: 'done' })],
});
const ARCHIVED = boardProblem({
  id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40006',
  title: 'Старая жалоба',
  archived_at: '2026-10-06T08:00:00+00:00',
});
/** What the board reads: no archive, the closed of the last month (api.ts). */
const BOARD = [OPEN, IVANS, OLGAS, ANNAS, RESOLVED];
/** What «Архив» reads, on demand. */
const ARCHIVE = [ARCHIVED];

type BoardAnswer = ReturnType<typeof useBoardProblems>;
type ArchiveAnswer = ReturnType<typeof useBoardArchive>;

function answer(overrides: Partial<BoardAnswer> = {}): void {
  jest.mocked(useBoardProblems).mockReturnValue({
    data: BOARD,
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
    ...overrides,
  } as BoardAnswer);
}

function answerArchive(overrides: Partial<ArchiveAnswer> = {}): void {
  jest.mocked(useBoardArchive).mockReturnValue({
    data: ARCHIVE,
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
    ...overrides,
  } as unknown as ArchiveAnswer);
}

function titles(): string[] {
  const [list] = screen.container.queryAll((node) => node.type === 'RCTSectionList');
  const scope = list === undefined ? screen : within(list);
  return [...BOARD, ...ARCHIVE]
    .map((problem) => problem.title)
    .filter((title) => scope.queryByText(title) !== null);
}

/** The ids the unread marks were asked for, call by call. */
function unreadAsked(): (readonly string[])[] {
  return jest.mocked(useUnreadSubjects).mock.calls.map(([, problemIds]) => problemIds);
}

beforeEach(() => {
  jest.clearAllMocks();
  answer();
  answerArchive();
  jest.mocked(useStaffDirectory).mockReturnValue({
    data: STAFF,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useStaffDirectory>);
});

describe('the status filter', () => {
  test('starts on «Все»: every task out of the archive, closed ones under their heading', async () => {
    await render(<BoardScreen />);

    expect(screen.getByRole('tab', { name: 'Все' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(titles()).toEqual([
      'Кран течёт',
      'Нет горячей воды',
      'Сломан замок',
      'Перегорела лампа',
      'Скрипит дверь',
    ]);
    expect(screen.getByText('Закрытые')).toBeTruthy();
  });

  test.each([
    ['Открыто', ['Кран течёт']],
    ['Назначено', ['Нет горячей воды', 'Перегорела лампа']],
    ['В работе', ['Сломан замок']],
    ['Выполнено', ['Скрипит дверь']],
    ['Архив', ['Старая жалоба']],
  ])('«%s» shows its tasks alone', async (chip, expected) => {
    await render(<BoardScreen />);

    await fireEvent.press(screen.getByRole('tab', { name: chip }));

    expect(titles()).toEqual(expected);
  });
});

// Item 11 of the two whole-branch reviews of phone-1-2-0: the board reads the
// newest 500 tasks; when it got that many, it says the list is cut there.
describe('a board read to its limit', () => {
  const LIMITED = 'Показаны последние 500';

  function manyTasks(count: number): BoardProblem[] {
    return Array.from({ length: count }, (_, index) =>
      boardProblem({
        id: `d1e2f3a4-1111-4111-8111-${String(index).padStart(12, '0')}`,
        title: `Задание ${index}`,
      }),
    );
  }

  test('says only the newest are shown', async () => {
    answer({ data: manyTasks(500) });

    await render(<BoardScreen />);

    expect(screen.getByText(LIMITED)).toBeTruthy();
  });

  test('says nothing of the kind below the limit, nor in the archive', async () => {
    answer({ data: manyTasks(499) });
    await render(<BoardScreen />);
    expect(screen.queryByText(LIMITED)).toBeNull();

    answer({ data: manyTasks(500) });
    await fireEvent.press(screen.getByRole('tab', { name: 'Архив' }));

    expect(screen.queryByText(LIMITED)).toBeNull();
  });
});

// A company's tasks only grow; the archive is history he looks up, not work
// waiting for him (brief, item 6).
describe('the archive', () => {
  test('is read only once «Архив» is chosen', async () => {
    await render(<BoardScreen />);

    expect(jest.mocked(useBoardArchive).mock.calls.every(([isOpen]) => isOpen === false)).toBe(
      true,
    );

    await fireEvent.press(screen.getByRole('tab', { name: 'Архив' }));

    expect(jest.mocked(useBoardArchive).mock.calls.at(-1)?.[0]).toBe(true);
  });

  test('«Ещё» reads the next page while there is one', async () => {
    const fetchNextPage = jest.fn();
    answerArchive({ hasNextPage: true, fetchNextPage });
    await render(<BoardScreen />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Архив' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ещё' }));

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  test('the last page offers no «Ещё», and the live board never does', async () => {
    await render(<BoardScreen />);
    expect(screen.queryByRole('button', { name: 'Ещё' })).toBeNull();

    await fireEvent.press(screen.getByRole('tab', { name: 'Архив' }));

    expect(screen.queryByRole('button', { name: 'Ещё' })).toBeNull();
  });

  test('while the archive loads, its shape stands in', async () => {
    answerArchive({ data: undefined, isPending: true });
    await render(<BoardScreen />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Архив' }));

    expect(screen.getByRole('progressbar', { name: 'Загружаем задания…' })).toBeTruthy();
  });
});

// One key for the marks, whatever the filters (brief, item 5): a filter is not
// a new question to the server, and a task does not lose its mark under one.
describe('the unread marks', () => {
  test('are asked for the whole board and the archive held, not for what the filters leave', async () => {
    await render(<BoardScreen />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Открыто' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Исполнитель: Все исполнители' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Иван Петров' }));

    const whole = [...BOARD, ...ARCHIVE].map((problem) => problem.id);
    expect(unreadAsked().length).toBeGreaterThan(1);
    expect(unreadAsked().every((ids) => ids.join() === whole.join())).toBe(true);
  });
});

describe('the assignee filter', () => {
  test('the sheet offers everybody, nobody, and the active technicians — him too', async () => {
    await render(<BoardScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Исполнитель: Все исполнители' }));

    const sheet = screen.getByTestId('board-assignee-sheet');
    expect(within(sheet).getByRole('header', { name: 'Исполнитель' })).toBeTruthy();
    const rows = within(sheet)
      .getAllByRole('button')
      .map((row) => row.props.accessibilityLabel as string);
    expect(rows).toEqual([
      'Закрыть',
      'Все исполнители',
      'Без исполнителя',
      'Иван Петров',
      'Ольга Сидорова',
      'Сергей Главный',
    ]);
  });

  test('a technician narrows the board to the tasks he holds, and the sheet closes', async () => {
    await render(<BoardScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Исполнитель: Все исполнители' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Иван Петров' }));

    expect(titles()).toEqual(['Нет горячей воды']);
    expect(screen.getByRole('button', { name: 'Исполнитель: Иван Петров' })).toBeTruthy();
    expect(screen.queryByTestId('board-assignee-sheet')).toBeNull();
  });

  test('«Без исполнителя» is the tasks still waiting for somebody', async () => {
    await render(<BoardScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Исполнитель: Все исполнители' }));
    await fireEvent.press(
      within(screen.getByTestId('board-assignee-sheet')).getByRole('button', {
        name: 'Без исполнителя',
      }),
    );

    expect(titles()).toEqual(['Кран течёт']);
  });

  test('the chosen one is said as selected on the sheet', async () => {
    await render(<BoardScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Исполнитель: Все исполнители' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ольга Сидорова' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Исполнитель: Ольга Сидорова' }));

    expect(
      screen.getByRole('button', { name: 'Ольга Сидорова' }).props.accessibilityState,
    ).toMatchObject({ selected: true });
  });

  test('both filters together, and an empty answer offers to clear them', async () => {
    await render(<BoardScreen />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Открыто' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Исполнитель: Все исполнители' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Иван Петров' }));

    expect(screen.getByText('Под эти фильтры ничего не подходит')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(titles()).toHaveLength(5);
  });

  // A closed or archived task holds nobody (archive_problem cancels the live
  // repair), so «Выполнено» or «Архив» with a person could never show a thing.
  test.each([
    ['Выполнено', ['Скрипит дверь']],
    ['Архив', ['Старая жалоба']],
  ])(
    '«%s» sets the person aside and says why; back on «Все» he applies again',
    async (chip, expected) => {
      await render(<BoardScreen />);
      await fireEvent.press(screen.getByRole('button', { name: 'Исполнитель: Все исполнители' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Иван Петров' }));

      await fireEvent.press(screen.getByRole('tab', { name: chip }));

      expect(titles()).toEqual(expected);
      const picker = screen.getByRole('button', { name: 'Исполнитель: Все исполнители' });
      expect(picker.props.accessibilityState).toMatchObject({ disabled: true });
      expect(
        screen.getByText('У закрытых и архивных заданий нет исполнителя — фильтр не действует'),
      ).toBeTruthy();

      await fireEvent.press(screen.getByRole('tab', { name: 'Все' }));

      expect(titles()).toEqual(['Нет горячей воды']);
      expect(screen.getByRole('button', { name: 'Исполнитель: Иван Петров' })).toBeTruthy();
    },
  );
});

describe('its states', () => {
  test('while it loads, the cards’ shape stands in, said as loading', async () => {
    answer({ data: undefined, isPending: true });

    await render(<BoardScreen />);

    expect(screen.getByRole('progressbar', { name: 'Загружаем задания…' })).toBeTruthy();
  });

  test('a board that never loaded says why and offers a retry', async () => {
    const refetch = jest.fn();
    answer({ data: undefined, error: new Error('Network request failed'), refetch });

    await render(<BoardScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(refetch).toHaveBeenCalled();
  });

  test('a refresh that failed keeps the board, the failure said above it', async () => {
    answer({ error: new Error('Network request failed') });

    await render(<BoardScreen />);

    expect(screen.getByText('Кран течёт')).toBeTruthy();
    expect(screen.getByText(/Не удалось обновить/)).toBeTruthy();
  });

  test('a company without tasks says so', async () => {
    answer({ data: [] as BoardProblem[] });

    await render(<BoardScreen />);

    expect(screen.getByText('Заданий нет')).toBeTruthy();
  });

  test('a card opens its task', async () => {
    await render(<BoardScreen />);

    await fireEvent.press(screen.getByRole('button', { name: /^Кран течёт\./ }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/problem/[id]',
      params: { id: OPEN.id },
    });
  });

  test('the names on the cards are the directory’s', async () => {
    await render(<BoardScreen />);

    expect(screen.getAllByText('Иван Петров').length).toBeGreaterThan(0);
    expect(screen.queryByText(TECH_IVAN)).toBeNull();
  });
});
