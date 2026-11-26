import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import type { BoardProblem } from '@/features/board/schema';
import { useBoardProblem } from '@/features/board/use-board';
import { PROBLEM_ID, boardProblem } from '@/testing/board-fixtures';
import { withClient } from '@/testing/restored-cache';

import { setProblemDue } from '../problem-api';
import { OfficeProblemDue } from '../problem-due';

/**
 * The office's «Дата выполнения» on a task's screen (owner, 2026-11-26): it plans the day, changes
 * it or clears it — sent at once or not at all, offered on the task as the server says it is now,
 * and only while somebody still has to see to it.
 */

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: 'c2d3e4f5-3333-4333-8333-c2d3e4f50001', isLoading: false }),
}));

jest.mock('@/features/board/use-board', () => ({ useBoardProblem: jest.fn() }));

jest.mock('../problem-api', () => ({ setProblemDue: jest.fn() }));

const TODAY = '2026-11-18';

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
  await render(<OfficeProblemDue problemId={PROBLEM_ID} />, { wrapper: withClient(client) });
}

function sent(): unknown[] {
  return jest.mocked(setProblemDue).mock.calls.map(([variables]) => variables);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Only the clock is faked: the render still waits on real timers.
  jest.useFakeTimers({
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  jest.setSystemTime(new Date(2026, 10, 18, 12, 0));
  jest.mocked(setProblemDue).mockResolvedValue(undefined);
  holds(boardProblem());
});
afterEach(() => jest.useRealTimers());

test('a task with no day: «Выбрать дату» opens the grid, and «Сохранить дату» sends the day', async () => {
  await show();
  expect(screen.queryByRole('button', { name: 'Убрать дату' })).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Выбрать дату' }));
  const sheet = within(screen.getByTestId('problem-due-sheet'));
  expect(sheet.getByText('Без даты')).toBeTruthy();
  // Nothing picked yet: nothing to save.
  expect(
    sheet.getByRole('button', { name: 'Сохранить дату' }).props.accessibilityState,
  ).toMatchObject({ disabled: true });
  await fireEvent.press(sheet.getByTestId('month-grid-day-2026-11-20'));
  await fireEvent.press(sheet.getByRole('button', { name: 'Сохранить дату' }));

  await waitFor(() => expect(sent()).toEqual([{ problemId: PROBLEM_ID, dueOn: '2026-11-20' }]));
  await waitFor(() => expect(screen.queryByTestId('problem-due-sheet')).toBeNull());
});

test('a planned day is changed from it, or cleared at once', async () => {
  holds(boardProblem({ due_on: '2026-11-25' }));
  await show();

  await fireEvent.press(screen.getByRole('button', { name: 'Изменить дату' }));
  const sheet = within(screen.getByTestId('problem-due-sheet'));
  expect(sheet.getByTestId('month-grid-day-2026-11-25').props.accessibilityState).toMatchObject({
    selected: true,
  });
  await fireEvent.press(sheet.getByRole('button', { name: 'Отмена' }));
  expect(sent()).toEqual([]);

  await fireEvent.press(screen.getByRole('button', { name: 'Убрать дату' }));
  await waitFor(() => expect(sent()).toEqual([{ problemId: PROBLEM_ID, dueOn: null }]));
});

test('a day out of range is said on the sheet, never sent', async () => {
  await show();

  await fireEvent.press(screen.getByRole('button', { name: 'Выбрать дату' }));
  const sheet = within(screen.getByTestId('problem-due-sheet'));
  await fireEvent.press(sheet.getByTestId('month-grid-day-2026-11-10'));

  expect(sheet.getByText('Дата выполнения — от вчерашнего дня до года вперёд')).toBeTruthy();
  expect(sheet.getByText('Без даты')).toBeTruthy();
  expect(sent()).toEqual([]);
});

test('a refusal is said in the reader’s words, and the day stays to try again', async () => {
  jest
    .mocked(setProblemDue)
    .mockRejectedValue(Object.assign(new Error('refused'), { hint: 'serverErrors.managerOnly' }));
  await show();

  await fireEvent.press(screen.getByRole('button', { name: 'Выбрать дату' }));
  const sheet = within(screen.getByTestId('problem-due-sheet'));
  await fireEvent.press(sheet.getByTestId(`month-grid-day-${TODAY}`));
  await fireEvent.press(sheet.getByRole('button', { name: 'Сохранить дату' }));

  expect(await sheet.findByText('Это действие доступно только менеджеру')).toBeTruthy();
  expect(screen.getByTestId('problem-due-sheet')).toBeTruthy();
});

test.each([
  ['closed', boardProblem({ status: 'resolved', due_on: '2026-11-25' })],
  ['archived', boardProblem({ archived_at: '2026-11-17T08:00:00Z' })],
])('a %s task offers no lever: it waits for no day', async (_kind, task) => {
  holds(task);
  await show();

  expect(screen.queryByRole('button', { name: /дату/ })).toBeNull();
});

test('the lever waits for the task as the server says it is now', async () => {
  holds(boardProblem(), false);
  await show();

  expect(
    screen.getByRole('button', { name: 'Выбрать дату' }).props.accessibilityState,
  ).toMatchObject({ disabled: true });
});
