import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import type { BoardProblem } from '@/features/board/schema';
import { staffNames } from '@/features/board/format';
import { useBoardProblem } from '@/features/board/use-board';
import { i18n } from '@/i18n';
import {
  CLEANER_ANNA,
  HEAD_TECH,
  PROBLEM_ID,
  STAFF,
  TECH_GONE,
  TECH_IVAN,
  TECH_OLGA,
  boardProblem,
  repair,
} from '@/testing/board-fixtures';
import { withClient } from '@/testing/restored-cache';

import { OfficeProblemActions, officeProblemActions } from '../problem-actions';
import { runProblemAction } from '../problem-api';
import { whoDidItChoices } from '../problem-sheets';

/**
 * The manager's levers on a task (problem) on the phone, as the panel pulls
 * them: «Отметить выполненным» naming who did it, «Отменить задание» with a
 * reason, «Вернуть в работу», the archive and back — each asked first, sent at
 * once, offered only on the task as the server says it is now.
 */

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: 'c2d3e4f5-3333-4333-8333-c2d3e4f50001', isLoading: false }),
}));

jest.mock('@/features/board/use-board', () => ({
  useBoardProblem: jest.fn(),
  useStaffDirectory: () => ({
    data: jest.requireActual<typeof import('@/testing/board-fixtures')>('@/testing/board-fixtures')
      .STAFF,
    error: null,
    refetch: jest.fn(),
  }),
}));

jest.mock('../problem-api', () => ({ runProblemAction: jest.fn() }));
// «Фото и видео…» goes on to the screen of the files (20261126100000).
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

function holds(task: BoardProblem, isCurrent = true): void {
  jest.mocked(useBoardProblem).mockReturnValue({
    data: task,
    error: null,
    isFetchedAfterMount: isCurrent,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useBoardProblem>);
}

async function show(): Promise<void> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(<OfficeProblemActions problemId={PROBLEM_ID} />, { wrapper: withClient(client) });
}

function sent(): unknown[] {
  return jest.mocked(runProblemAction).mock.calls.map(([action]) => action);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(runProblemAction).mockResolvedValue(undefined);
  holds(boardProblem());
});

describe('which levers a task offers', () => {
  test('live: done, cancel, the archive; closed: open again, the archive; archived: back only', () => {
    expect(officeProblemActions(boardProblem())).toEqual(['resolve', 'cancel', 'archive']);
    expect(officeProblemActions(boardProblem({ status: 'cancelled' }))).toEqual([
      'reopen',
      'archive',
    ]);
    expect(
      officeProblemActions(boardProblem({ status: 'resolved', archived_at: '2026-10-06T08:00:00Z' })),
    ).toEqual(['unarchive']);
  });

  test('who may have done it: the holder first, the technicians at work, then those switched off', () => {
    const names = staffNames(STAFF, i18n.t);

    expect(whoDidItChoices(STAFF, CLEANER_ANNA, names).map((person) => person.id)).toEqual([
      CLEANER_ANNA,
      TECH_IVAN,
      TECH_OLGA,
      HEAD_TECH,
      TECH_GONE,
    ]);
    expect(whoDidItChoices(STAFF, null, names)[0].id).toBe(TECH_IVAN);
  });
});

describe('«Отметить выполненным»', () => {
  test('asks who did it — nobody by default — and closes it as the manager’s own', async () => {
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Отметить выполненным' }));
    const sheet = within(screen.getByTestId('resolve-sheet'));
    expect(
      sheet.getByRole('radio', { name: 'Никто, менеджер сам' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
    expect(runProblemAction).not.toHaveBeenCalled();
    await fireEvent.press(sheet.getByRole('button', { name: 'Да, выполнено' }));

    await waitFor(() =>
      expect(sent()).toEqual([{ kind: 'resolve', problemId: PROBLEM_ID, completedBy: null, closing: null }]),
    );
    await waitFor(() => expect(screen.queryByTestId('resolve-sheet')).toBeNull());
  });

  test('names the holder first, and the person chosen is sent', async () => {
    holds(boardProblem({ status: 'assigned', fix_tasks: [repair()] }));
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Отметить выполненным' }));
    const sheet = within(screen.getByTestId('resolve-sheet'));
    const people = sheet.getAllByRole('radio').map((row) => row.props.accessibilityLabel);
    expect(people[1]).toBe('Иван Петров · текущий исполнитель');
    await fireEvent.press(sheet.getByRole('radio', { name: 'Иван Петров · текущий исполнитель' }));
    expect(sheet.getByText(/Уведомление сотруднику не придёт/)).toBeTruthy();
    await fireEvent.press(sheet.getByRole('button', { name: 'Да, выполнено' }));

    await waitFor(() =>
      expect(sent()).toEqual([{ kind: 'resolve', problemId: PROBLEM_ID, completedBy: TECH_IVAN, closing: null }]),
    );
  });
});

describe('«Отменить задание»', () => {
  test('sends the reason trimmed', async () => {
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Отменить задание' }));
    const sheet = within(screen.getByTestId('cancel-problem-sheet'));
    await fireEvent.changeText(sheet.getByLabelText('Причина отмены (необязательно)'), '  Дубль ');
    await fireEvent.press(sheet.getByRole('button', { name: 'Подтвердить отмену' }));

    await waitFor(() =>
      expect(sent()).toEqual([{ kind: 'cancel', problemId: PROBLEM_ID, reason: 'Дубль' }]),
    );
  });

  test('«Не отменять» sends nothing', async () => {
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Отменить задание' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Не отменять' }));

    expect(screen.queryByTestId('cancel-problem-sheet')).toBeNull();
    expect(runProblemAction).not.toHaveBeenCalled();
  });
});

test('a closed task is opened again once asked', async () => {
  holds(boardProblem({ status: 'resolved' }));
  await show();

  await fireEvent.press(screen.getByRole('button', { name: 'Вернуть в работу' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Да, вернуть' }));

  await waitFor(() => expect(sent()).toEqual([{ kind: 'reopen', problemId: PROBLEM_ID }]));
});

test('an archived task comes back from the archive once asked', async () => {
  holds(boardProblem({ status: 'cancelled', archived_at: '2026-10-06T08:00:00+00:00' }));
  await show();

  await fireEvent.press(screen.getByRole('button', { name: 'Восстановить из архива' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Да, восстановить' }));

  await waitFor(() => expect(sent()).toEqual([{ kind: 'unarchive', problemId: PROBLEM_ID }]));
});

test('a refusal is said under the levers in the reader’s words', async () => {
  jest
    .mocked(runProblemAction)
    .mockRejectedValue(Object.assign(new Error('refused'), { hint: 'serverErrors.managerOnly' }));
  await show();

  await fireEvent.press(screen.getByRole('button', { name: 'Удалить в архив' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Да, в архив' }));

  expect(await screen.findByText('Это действие доступно только менеджеру')).toBeTruthy();
});

test('the levers wait for the task as the server says it is now', async () => {
  holds(boardProblem(), false);
  await show();

  for (const name of ['Отметить выполненным', 'Отменить задание', 'Удалить в архив']) {
    expect(screen.getByRole('button', { name }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  }
});

describe('«Отметить выполненным» with a comment and files (20261126100000)', () => {
  test('a comment goes with the closing, in one press', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Отметить выполненным' }));
    const sheet = within(screen.getByTestId('resolve-sheet'));
    await fireEvent.changeText(sheet.getByLabelText('Комментарий (необязательно)'), '  Кран заменён  ');
    await fireEvent.press(sheet.getByRole('button', { name: 'Да, выполнено' }));

    await waitFor(() => expect(runProblemAction).toHaveBeenCalledTimes(1));
    expect(sent()[0]).toMatchObject({
      kind: 'resolve',
      problemId: PROBLEM_ID,
      completedBy: null,
      closing: { comment: 'Кран заменён' },
    });
    expect(sent()[0]).toHaveProperty('closing.additionId');
    expect(sent()[0]).toHaveProperty('closing.commentId');
  });

  test('«Добавить фото или видео» carries the choice and the words on to the screen of the files', async () => {
    const { router } = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Отметить выполненным' }));
    const sheet = within(screen.getByTestId('resolve-sheet'));
    await fireEvent.press(sheet.getByRole('radio', { name: /Иван/ }));
    await fireEvent.changeText(sheet.getByLabelText('Комментарий (необязательно)'), 'Готово');
    await fireEvent.press(sheet.getByRole('button', { name: 'Добавить фото или видео' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/problem/[id]/add-files',
      params: { id: PROBLEM_ID, mode: 'closing', who: TECH_IVAN, comment: 'Готово' },
    });
    expect(runProblemAction).not.toHaveBeenCalled();
    expect(screen.queryByTestId('resolve-sheet')).toBeNull();
  });
});
