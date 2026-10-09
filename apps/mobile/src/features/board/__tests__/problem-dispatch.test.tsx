import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, type AlertButton } from 'react-native';

import { calendarDay } from '@/features/tasks/schema';
import {
  CLEANER_ANNA,
  HEAD_TECH,
  PROBLEM_ID,
  REPAIR_ID,
  STAFF,
  TECH_IVAN,
  TECH_OLGA,
  boardProblem,
  repair,
  today,
} from '@/testing/board-fixtures';
import { withClient } from '@/testing/restored-cache';

import { assignProblem, fetchBoardProblem, fetchStaffDirectory, unassignProblem } from '../api';
import { boardKeys } from '../keys';
import { ProblemDispatch } from '../problem-dispatch';
import type { BoardProblem } from '../schema';

/**
 * «Назначить» and «Снять» on a task's screen, the head technician's alone
 * (brief, item 2; decisions 1, 8, 17). He hands an open task to an active
 * technician — himself among them — for a day, today unless he says
 * otherwise, and takes off whoever holds its repair, naming the person the
 * screen showed. Cancelling, closing and the archive are the manager's: there
 * is no button for them here. Each move is sent at once and said if refused;
 * the screen changes only when the server is read again.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('../api', () => ({
  fetchBoardProblem: jest.fn(),
  fetchBoardProblems: jest.fn(),
  fetchStaffDirectory: jest.fn(),
  assignProblem: jest.fn(),
  unassignProblem: jest.fn(),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

/** A press on one of the buttons of the question asked last, by its word. */
function pressInAlert(alert: jest.SpyInstance, word: string): void {
  const choices = (alert.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  const choice = choices.find((item) => item.text === word);
  if (choice === undefined) {
    throw new Error(`No «${word}» in the question`);
  }
  choice.onPress?.();
}

function refusal(hint: string): Error {
  return Object.assign(new Error('refused'), { hint });
}

/**
 * The task and the directory as the phone already holds them, fresh: the
 * section draws them at once, and only a move makes it read again.
 */
function client(problem: BoardProblem): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  queryClient.setQueryData(boardKeys.one(HEAD_TECH, PROBLEM_ID), problem);
  queryClient.setQueryData(boardKeys.staff(HEAD_TECH), STAFF);
  return queryClient;
}

async function show(problem: BoardProblem): Promise<void> {
  jest.mocked(fetchBoardProblem).mockResolvedValue(problem);
  await render(<ProblemDispatch problemId={PROBLEM_ID} />, {
    wrapper: withClient(client(problem)),
  });
}

/** Every button the section offers, by name, outside any open sheet. */
function buttons(): string[] {
  return screen
    .getAllByRole('button')
    .map((button) => button.props.accessibilityLabel as string)
    .sort();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchStaffDirectory).mockResolvedValue(STAFF);
  jest.mocked(assignProblem).mockResolvedValue(undefined);
  jest.mocked(unassignProblem).mockResolvedValue(undefined);
});

describe('an open task nobody holds', () => {
  test('says so, and offers «Назначить» and the history — nothing of the manager’s', async () => {
    await show(boardProblem());

    expect(screen.getByText('Без исполнителя')).toBeTruthy();
    expect(buttons()).toEqual(['История', 'Назначить']);
  });

  test('«Назначить» opens the sheet: today chosen, the active technicians and himself', async () => {
    await show(boardProblem());

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));

    const sheet = screen.getByTestId('assign-sheet');
    expect(within(sheet).getByRole('header', { name: 'Назначить работу' })).toBeTruthy();
    expect(
      within(sheet).getByRole('radio', { name: 'Сегодня' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
    const people = within(sheet)
      .getAllByRole('radio')
      .map((row) => row.props.accessibilityLabel as string)
      .filter((label) => !/^(Сегодня|Завтра|[А-Я][а-я]{1,2},)/.test(label));
    expect(people).toEqual(['Иван Петров', 'Ольга Сидорова', 'Сергей Главный, Это вы']);
    expect(within(sheet).queryByText('Анна Белова')).toBeNull();
    expect(within(sheet).queryByText('Пётр Уволенный')).toBeNull();
  });

  test('the sheet offers a week of days, today first', async () => {
    await show(boardProblem());

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));

    const days = within(screen.getByTestId('assign-sheet'))
      .getAllByRole('radio')
      .slice(0, 7)
      .map((chip) => chip.props.accessibilityLabel as string);
    expect(days.slice(0, 2)).toEqual(['Сегодня', 'Завтра']);
    expect(days).toHaveLength(7);
  });

  test('nothing is sent before a technician is chosen', async () => {
    await show(boardProblem());

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));
    const confirm = within(screen.getByTestId('assign-sheet')).getByRole('button', {
      name: 'Назначить',
    });

    expect(confirm.props.accessibilityState).toMatchObject({ disabled: true });
  });

  test('sends the task, the technician and the day chosen; the sheet closes', async () => {
    await show(boardProblem());

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));
    const sheet = screen.getByTestId('assign-sheet');
    await fireEvent.press(within(sheet).getByRole('radio', { name: 'Ольга Сидорова' }));
    await fireEvent.press(within(sheet).getByRole('radio', { name: 'Завтра' }));
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Назначить' }));

    await waitFor(() => expect(screen.queryByTestId('assign-sheet')).toBeNull());
    expect(assignProblem).toHaveBeenCalledTimes(1);
    expect(jest.mocked(assignProblem).mock.calls[0][0]).toEqual({
      problemId: PROBLEM_ID,
      assigneeId: TECH_OLGA,
      scheduledDate: calendarDay(new Date(), 1),
      timeFrom: null,
      timeTo: null,
    });
  });

  test('he may hand it to himself, for today by default', async () => {
    await show(boardProblem());

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));
    const sheet = screen.getByTestId('assign-sheet');
    await fireEvent.press(within(sheet).getByRole('radio', { name: 'Сергей Главный, Это вы' }));
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Назначить' }));

    await waitFor(() => expect(assignProblem).toHaveBeenCalled());
    expect(jest.mocked(assignProblem).mock.calls[0][0]).toMatchObject({
      assigneeId: HEAD_TECH,
      scheduledDate: today(),
    });
  });

  test('a waiting repair keeps the hours the office gave it', async () => {
    await show(
      boardProblem({
        fix_tasks: [
          repair({
            assignee_id: null,
            status: 'unassigned',
            time_from: '10:00:00',
            time_to: '12:00:00',
          }),
        ],
      }),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));
    const sheet = screen.getByTestId('assign-sheet');
    await fireEvent.press(within(sheet).getByRole('radio', { name: 'Иван Петров' }));
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Назначить' }));

    await waitFor(() => expect(assignProblem).toHaveBeenCalled());
    expect(jest.mocked(assignProblem).mock.calls[0][0]).toMatchObject({
      timeFrom: '10:00:00',
      timeTo: '12:00:00',
    });
  });

  test('a refusal is said in his words on the sheet, which stays open', async () => {
    jest.mocked(assignProblem).mockRejectedValue(refusal('serverErrors.repairNeedsTech'));
    await show(boardProblem());

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));
    const sheet = screen.getByTestId('assign-sheet');
    await fireEvent.press(within(sheet).getByRole('radio', { name: 'Иван Петров' }));
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Назначить' }));

    expect(
      await within(sheet).findByText('Главный техник назначает работу только техникам'),
    ).toBeTruthy();
    expect(screen.getByTestId('assign-sheet')).toBeTruthy();
  });
});

describe('a task whose repair somebody holds', () => {
  const held = boardProblem({
    status: 'assigned',
    fix_tasks: [repair({ time_from: '10:00:00', time_to: '12:00:00' })],
  });

  test('names the person and the day, and offers «Снять с работы», not «Назначить»', async () => {
    await show(held);

    expect(screen.getByText('Иван Петров')).toBeTruthy();
    expect(screen.getByText('Сегодня · 10:00–12:00')).toBeTruthy();
    expect(buttons()).toEqual(['История', 'Снять с работы']);
  });

  test('asks first, then takes off the person the screen showed', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await show(held);

    await fireEvent.press(screen.getByRole('button', { name: 'Снять с работы' }));
    expect(alert).toHaveBeenCalledWith(
      'Снять с работы?',
      'Иван Петров: работа будет отменена, задание вернётся в открытые.',
      expect.any(Array),
    );
    expect(unassignProblem).not.toHaveBeenCalled();
    pressInAlert(alert, 'Снять');

    await waitFor(() => expect(unassignProblem).toHaveBeenCalledTimes(1));
    expect(jest.mocked(unassignProblem).mock.calls[0][0]).toEqual({
      taskId: REPAIR_ID,
      expectedAssigneeId: TECH_IVAN,
    });
  });

  test('a cleaner on a repair can be taken off too (decision 17)', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await show(
      boardProblem({
        status: 'in_progress',
        fix_tasks: [repair({ assignee_id: CLEANER_ANNA, status: 'in_progress' })],
      }),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Снять с работы' }));
    pressInAlert(alert, 'Снять');

    await waitFor(() =>
      expect(jest.mocked(unassignProblem).mock.calls[0]?.[0]).toEqual({
        taskId: REPAIR_ID,
        expectedAssigneeId: CLEANER_ANNA,
      }),
    );
  });

  test('a repair that changed meanwhile is said so, translated', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    jest.mocked(unassignProblem).mockRejectedValue(refusal('serverErrors.taskChangedMeanwhile'));
    await show(held);

    await fireEvent.press(screen.getByRole('button', { name: 'Снять с работы' }));
    pressInAlert(alert, 'Снять');

    expect(await screen.findByText('Это уже изменилось — экран обновлён')).toBeTruthy();
  });

  test('the history opens on its own screen', async () => {
    await show(held);

    await fireEvent.press(screen.getByRole('button', { name: 'История' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/problem/[id]/history',
      params: { id: PROBLEM_ID },
    });
  });
});

describe('what is the manager’s alone', () => {
  test.each(['resolved', 'cancelled'] as const)(
    'a %s task offers only its history',
    async (status) => {
      await show(boardProblem({ status, fix_tasks: [repair({ status: 'done' })] }));

      expect(buttons()).toEqual(['История']);
      expect(screen.queryByText('Без исполнителя')).toBeNull();
    },
  );

  test('a task without a listing says why it cannot be handed out', async () => {
    await show(boardProblem({ property_id: null, property: null }));

    expect(screen.getByText('У задания нет объекта — назначить нельзя')).toBeTruthy();
    expect(buttons()).toEqual(['История']);
  });

  test('an archived task is not handed out', async () => {
    await show(boardProblem({ archived_at: '2026-10-06T08:00:00+00:00' }));

    expect(buttons()).toEqual(['История']);
  });
});
