import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, type AlertButton } from 'react-native';

import { formatDayHeading } from '@/features/tasks/format';
import { calendarDay } from '@/features/tasks/schema';
import { i18n } from '@/i18n';
import { createAppQueryClient } from '@/lib/query-client';
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
import type { BoardProblem, StaffMember } from '../schema';

/**
 * «Назначить» and «Снять» on a task's screen, the head technician's alone
 * (brief, item 2; decisions 1, 8, 17). He hands an open task to an active
 * technician — himself among them — for a day, today unless he says
 * otherwise, and takes off whoever holds its repair, naming the person the
 * screen showed. Cancelling, closing and the archive are the manager's: there
 * is no button for them here. Each move is sent at once and said if refused;
 * the screen changes only when the server is read again — and no move is
 * offered on a copy the screen has not read from the server since it opened.
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** An answer of the server the test gives when it chooses to. */
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onValue, onError) => {
    resolve = onValue;
    reject = onError;
  });
  return { promise, resolve, reject };
}

/**
 * The app's own client (createAppQueryClient): the moves run on the
 * production defaults, so what makes them dispatch — one try, never queued —
 * is their own options, not the test's. Reads are not retried and never
 * collected, so a failure is said at once and nothing holds the worker.
 */
function appClient(): QueryClient {
  const queryClient = createAppQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false, gcTime: Infinity },
  });
  return queryClient;
}

interface Held {
  /** The task as the phone already holds it, or none: then the board's copy stands in. */
  task?: BoardProblem | null;
  /** The board's list, for a task opened from it. */
  board?: BoardProblem[];
  /** The directory as the phone holds it; none — it is read. */
  staff?: StaffMember[] | null;
  /** When the held task was read: a copy restored from an earlier day is old. */
  readAt?: number;
}

function client({ task, board, staff = STAFF, readAt }: Held): QueryClient {
  const queryClient = appClient();
  if (task !== undefined && task !== null) {
    queryClient.setQueryData(boardKeys.one(HEAD_TECH, PROBLEM_ID), task, { updatedAt: readAt });
  }
  if (board !== undefined) {
    queryClient.setQueryData(boardKeys.list(HEAD_TECH), board);
  }
  if (staff !== null) {
    queryClient.setQueryData(boardKeys.staff(HEAD_TECH), staff);
  }
  return queryClient;
}

/** Draws the section; the server answers with `problem` unless the test said otherwise. */
async function draw(queryClient: QueryClient) {
  return render(<ProblemDispatch problemId={PROBLEM_ID} />, {
    wrapper: withClient(queryClient),
  });
}

/**
 * The read the screen makes when it opens has landed, and the screen has drawn
 * it: TanStack tells its hooks on the next turn of the loop (notifyManager's
 * `setTimeout(0)`), so the test waits one turn too.
 */
async function readLanded(queryClient: QueryClient): Promise<void> {
  await waitFor(() => expect(fetchBoardProblem).toHaveBeenCalled());
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  await nextTurn();
}

/** One turn of the event loop, for TanStack's news to reach the screen. */
async function nextTurn(): Promise<void> {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

/** The task as the phone holds it, read again from the server as the screen opens. */
async function show(problem: BoardProblem): Promise<QueryClient> {
  jest.mocked(fetchBoardProblem).mockResolvedValue(problem);
  const queryClient = client({ task: problem });
  await draw(queryClient);
  await readLanded(queryClient);
  return queryClient;
}

/** Every button the section offers, by name, outside any open sheet. */
function buttons(): string[] {
  return screen
    .getAllByRole('button')
    .map((button) => button.props.accessibilityLabel as string)
    .sort();
}

function stateOf(name: string): { disabled?: boolean; busy?: boolean } {
  return screen.getByRole('button', { name }).props.accessibilityState;
}

function sheetButton(name: string) {
  return within(screen.getByTestId('assign-sheet')).getByRole('button', { name });
}

/** Opens «Назначить» and chooses a technician on the sheet. */
async function choose(person: string): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));
  await fireEvent.press(
    within(screen.getByTestId('assign-sheet')).getByRole('radio', { name: person }),
  );
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
    expect(stateOf('Назначить')).toMatchObject({ disabled: false });
  });

  test('«Назначить» opens the sheet: today chosen, the active technicians and himself', async () => {
    await show(boardProblem());

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));

    const sheet = screen.getByTestId('assign-sheet');
    expect(within(sheet).getByRole('header', { name: 'Назначить работу' })).toBeTruthy();
    expect(
      within(sheet).getByRole('radio', { name: 'Сегодня' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
    const people = within(within(sheet).getByLabelText('Техник'))
      .getAllByRole('radio')
      .map((row) => row.props.accessibilityLabel as string);
    expect(people).toEqual(['Иван Петров', 'Ольга Сидорова', 'Сергей Главный, Это вы']);
    expect(within(sheet).queryByText('Анна Белова')).toBeNull();
    expect(within(sheet).queryByText('Пётр Уволенный')).toBeNull();
  });

  // The technician sees a repair seven days ahead and no further
  // (docs/tech-plan.md §5): today and the seven days after it.
  test('the sheet offers today and the seven days of his horizon', async () => {
    await show(boardProblem());

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));

    const days = within(screen.getByLabelText('День'))
      .getAllByRole('radio')
      .map((chip) => chip.props.accessibilityLabel as string);
    expect(days).toHaveLength(8);
    expect(days.slice(0, 2)).toEqual(['Сегодня', 'Завтра']);
    expect(days[7]).toBe(formatDayHeading(calendarDay(new Date(), 7)));
  });

  test('nothing is sent before a technician is chosen', async () => {
    await show(boardProblem());

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));

    expect(sheetButton('Назначить').props.accessibilityState).toMatchObject({ disabled: true });
  });

  test('sends the task, the technician and the day chosen; the sheet closes', async () => {
    await show(boardProblem());

    await choose('Ольга Сидорова');
    await fireEvent.press(
      within(screen.getByTestId('assign-sheet')).getByRole('radio', { name: 'Завтра' }),
    );
    await fireEvent.press(sheetButton('Назначить'));

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

    await choose('Сергей Главный, Это вы');
    await fireEvent.press(sheetButton('Назначить'));

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

    await choose('Иван Петров');
    await fireEvent.press(sheetButton('Назначить'));

    await waitFor(() => expect(assignProblem).toHaveBeenCalled());
    expect(jest.mocked(assignProblem).mock.calls[0][0]).toMatchObject({
      timeFrom: '10:00:00',
      timeTo: '12:00:00',
    });
  });

  // On the app's own defaults a refused move would be tried again a second
  // later (lib/query-client.ts): the dispatch's one try is its own.
  test('a refusal is said in his words on the sheet, which stays open; it is sent once', async () => {
    jest.mocked(assignProblem).mockRejectedValue(refusal('serverErrors.repairNeedsTech'));
    await show(boardProblem());

    await choose('Иван Петров');
    await fireEvent.press(sheetButton('Назначить'));

    expect(
      await within(screen.getByTestId('assign-sheet')).findByText(
        'Главный техник назначает работу только техникам',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('assign-sheet')).toBeTruthy();
    expect(assignProblem).toHaveBeenCalledTimes(1);
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
    expect(stateOf('Снять с работы')).toMatchObject({ disabled: false });
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

  test('a repair that changed meanwhile is said so, translated, and asked once', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    jest.mocked(unassignProblem).mockRejectedValue(refusal('serverErrors.taskChangedMeanwhile'));
    await show(held);

    await fireEvent.press(screen.getByRole('button', { name: 'Снять с работы' }));
    pressInAlert(alert, 'Снять');

    expect(await screen.findByText('Это уже изменилось — экран обновлён')).toBeTruthy();
    expect(unassignProblem).toHaveBeenCalledTimes(1);
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

// A move is done when the screen shows what came of it (brief, item 3): the
// buttons wait for the server's answer and for the task read again after it.
describe('a move under way', () => {
  const olgas = boardProblem({
    status: 'assigned',
    fix_tasks: [repair({ assignee_id: TECH_OLGA })],
  });

  test('the sheet’s «Назначить» stays busy until the task is read again', async () => {
    await show(boardProblem());
    const reread = deferred<BoardProblem>();
    jest.mocked(fetchBoardProblem).mockReturnValueOnce(reread.promise);

    await choose('Ольга Сидорова');
    await fireEvent.press(sheetButton('Назначить'));
    await waitFor(() => expect(fetchBoardProblem).toHaveBeenCalledTimes(2));
    await nextTurn();

    // The server said yes and is being read again; the screen does not know it yet.
    expect(assignProblem).toHaveBeenCalledTimes(1);
    expect(sheetButton('Назначить').props.accessibilityState).toMatchObject({ busy: true });

    await act(async () => reread.resolve(olgas));

    await waitFor(() => expect(screen.queryByTestId('assign-sheet')).toBeNull());
    expect(screen.getByText('Ольга Сидорова')).toBeTruthy();
    expect(buttons()).toEqual(['История', 'Снять с работы']);
  });

  test('a double tap hands the task out once', async () => {
    const answer = deferred<undefined>();
    jest.mocked(assignProblem).mockReturnValueOnce(answer.promise);
    await show(boardProblem());

    await choose('Ольга Сидорова');
    await fireEvent.press(sheetButton('Назначить'));
    await fireEvent.press(sheetButton('Назначить'));

    expect(assignProblem).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve(undefined));
  });

  test('closing the sheet keeps the move: «Назначить» waits busy and does not open again', async () => {
    const answer = deferred<undefined>();
    jest.mocked(assignProblem).mockReturnValueOnce(answer.promise);
    await show(boardProblem());

    await choose('Ольга Сидорова');
    await fireEvent.press(sheetButton('Назначить'));
    await fireEvent.press(sheetButton('Закрыть'));
    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));

    expect(screen.queryByTestId('assign-sheet')).toBeNull();
    expect(stateOf('Назначить')).toMatchObject({ busy: true });

    jest.mocked(fetchBoardProblem).mockResolvedValue(olgas);
    await act(async () => answer.resolve(undefined));

    expect(await screen.findByText('Ольга Сидорова')).toBeTruthy();
    expect(assignProblem).toHaveBeenCalledTimes(1);
  });

  test('«Снять с работы» waits busy until the task is read again', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await show(olgas);
    const reread = deferred<BoardProblem>();
    jest.mocked(fetchBoardProblem).mockReturnValueOnce(reread.promise);

    await fireEvent.press(screen.getByRole('button', { name: 'Снять с работы' }));
    pressInAlert(alert, 'Снять');
    await waitFor(() => expect(fetchBoardProblem).toHaveBeenCalledTimes(2));
    await nextTurn();

    expect(stateOf('Снять с работы')).toMatchObject({ busy: true });

    await act(async () => reread.resolve(boardProblem()));

    expect(await screen.findByText('Без исполнителя')).toBeTruthy();
    expect(buttons()).toEqual(['История', 'Назначить']);
  });

  test('a move still under way when he comes back keeps the buttons off', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const answer = deferred<undefined>();
    jest.mocked(unassignProblem).mockReturnValueOnce(answer.promise);
    jest.mocked(fetchBoardProblem).mockResolvedValue(olgas);
    const queryClient = client({ task: olgas });
    const first = await draw(queryClient);
    await readLanded(queryClient);

    await fireEvent.press(screen.getByRole('button', { name: 'Снять с работы' }));
    pressInAlert(alert, 'Снять');
    await waitFor(() => expect(unassignProblem).toHaveBeenCalled());
    await first.unmount();
    await draw(queryClient);
    await readLanded(queryClient);

    expect(stateOf('Снять с работы')).toMatchObject({ disabled: true });

    jest.mocked(fetchBoardProblem).mockResolvedValue(boardProblem());
    await act(async () => answer.resolve(undefined));

    await waitFor(() => expect(stateOf('Назначить')).toMatchObject({ disabled: false }));
  });
});

// The board's copy, or one kept on the phone from before, may be hours old:
// a hand-out decided on it would overrule what the office did since (brief,
// item 4). The screen reads the task as it opens and offers the moves only
// on what it read.
describe('a copy the screen has not read', () => {
  test('a task opened from the board waits for its own read before anything is handed out', async () => {
    const read = deferred<BoardProblem>();
    jest.mocked(fetchBoardProblem).mockReturnValueOnce(read.promise);
    const queryClient = client({ board: [boardProblem()] });

    await draw(queryClient);

    expect(screen.getByText('Без исполнителя')).toBeTruthy();
    expect(stateOf('Назначить')).toMatchObject({ disabled: true });

    await act(async () => read.resolve(boardProblem()));

    await waitFor(() => expect(stateOf('Назначить')).toMatchObject({ disabled: false }));
  });

  test('a copy kept from an earlier day is read again before anybody is taken off', async () => {
    const read = deferred<BoardProblem>();
    jest.mocked(fetchBoardProblem).mockReturnValueOnce(read.promise);
    const held = boardProblem({ status: 'assigned', fix_tasks: [repair()] });
    const queryClient = client({ task: held, readAt: Date.now() - 6 * 60 * 60 * 1000 });

    await draw(queryClient);

    expect(stateOf('Снять с работы')).toMatchObject({ disabled: true });

    // Meanwhile the office gave it to Olga: that is what the screen offers to take off.
    const olgas = boardProblem({
      status: 'assigned',
      fix_tasks: [repair({ assignee_id: TECH_OLGA })],
    });
    await act(async () => read.resolve(olgas));

    await waitFor(() => expect(stateOf('Снять с работы')).toMatchObject({ disabled: false }));
    expect(screen.getByText('Ольга Сидорова')).toBeTruthy();
  });

  test('a read that failed over the copy says so, keeps the moves off, and «Повторить» reads again', async () => {
    jest.mocked(fetchBoardProblem).mockRejectedValueOnce(new Error('Network request failed'));
    const queryClient = client({ board: [boardProblem()] });

    await draw(queryClient);

    expect(
      await screen.findByText('Задание не обновилось — назначить и снять можно после обновления'),
    ).toBeTruthy();
    expect(stateOf('Назначить')).toMatchObject({ disabled: true });

    jest.mocked(fetchBoardProblem).mockResolvedValue(boardProblem());
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(stateOf('Назначить')).toMatchObject({ disabled: false }));
    expect(
      screen.queryByText('Задание не обновилось — назначить и снять можно после обновления'),
    ).toBeNull();
  });
});

// Names come from the directory (staff_directory); the screen never shows a
// person's mail or phone to tell people apart — they are not even read.
describe('the names', () => {
  const held = boardProblem({ status: 'assigned', fix_tasks: [repair()] });

  test('«Снять с работы» waits for the names: the question names the person', async () => {
    const names = deferred<StaffMember[]>();
    jest.mocked(fetchStaffDirectory).mockReturnValueOnce(names.promise);
    jest.mocked(fetchBoardProblem).mockResolvedValue(held);
    const queryClient = client({ task: held, staff: null });

    await draw(queryClient);
    await waitFor(() => expect(fetchBoardProblem).toHaveBeenCalled());

    expect(stateOf('Снять с работы')).toMatchObject({ disabled: true });

    await act(async () => names.resolve(STAFF));

    await waitFor(() => expect(stateOf('Снять с работы')).toMatchObject({ disabled: false }));
    expect(screen.getByText('Иван Петров')).toBeTruthy();
  });

  test('a directory that failed says so on the sheet, and «Повторить» reads it again', async () => {
    jest.mocked(fetchStaffDirectory).mockRejectedValueOnce(new Error('Network request failed'));
    jest.mocked(fetchBoardProblem).mockResolvedValue(boardProblem());
    const queryClient = client({ task: boardProblem(), staff: null });
    await draw(queryClient);
    await readLanded(queryClient);

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));
    const sheet = screen.getByTestId('assign-sheet');
    expect(
      await within(sheet).findByText('Не удалось выполнить действие. Попробуйте ещё раз.'),
    ).toBeTruthy();

    jest.mocked(fetchStaffDirectory).mockResolvedValue(STAFF);
    await fireEvent.press(within(sheet).getByRole('button', { name: 'Повторить' }));

    expect(await within(sheet).findByRole('radio', { name: 'Иван Петров' })).toBeTruthy();
  });

  test('technicians without a name are told apart by their order, «Техник 1» and «Техник 2»', async () => {
    const NAMELESS_A = 'c3d4e5f6-0000-4000-8000-00000000aaaa';
    const NAMELESS_B = 'c3d4e5f6-0000-4000-8000-00000000bbbb';
    const staff: StaffMember[] = [
      ...STAFF,
      { id: NAMELESS_A, full_name: null, role: 'tech', is_active: true },
      { id: NAMELESS_B, full_name: '  ', role: 'tech', is_active: true },
    ];
    jest.mocked(fetchBoardProblem).mockResolvedValue(boardProblem());
    const queryClient = client({ task: boardProblem(), staff });
    await draw(queryClient);
    await readLanded(queryClient);

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));

    const people = within(screen.getByLabelText('Техник'))
      .getAllByRole('radio')
      .map((row) => row.props.accessibilityLabel as string);
    expect(people).toEqual([
      'Иван Петров',
      'Ольга Сидорова',
      'Сергей Главный, Это вы',
      'Техник 1',
      'Техник 2',
    ]);
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

  test('a task without a listing says why it cannot be handed out, in the screen’s own words', async () => {
    await show(boardProblem({ property_id: null, property: null }));

    expect(screen.getByText(i18n.t('problems.dispatch.noProperty'))).toBeTruthy();
    expect(screen.getByText('У задания нет объекта — назначить нельзя')).toBeTruthy();
    expect(buttons()).toEqual(['История']);
  });

  test('an archived task is not handed out', async () => {
    await show(boardProblem({ archived_at: '2026-10-06T08:00:00+00:00' }));

    expect(buttons()).toEqual(['История']);
  });
});
