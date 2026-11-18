import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import TaskRoute from '@/app/task/[id]';
import type { StaffMember } from '@/features/board/schema';
import { destinationOf } from '@/features/push/destination';
import type { TaskStep } from '@/features/steps/schema';
import { useTaskSteps } from '@/features/steps/use-steps';
import { cancelCleaning, fetchTask } from '@/features/tasks/api';
import { CLEANER_ANNA, STAFF } from '@/testing/board-fixtures';
import { CLEANER_VERA, MANAGER, TASK_ID, officeTask } from '@/testing/office-fixtures';
import { withClient } from '@/testing/restored-cache';

import { assignCleaning, fetchOfficeTask, restoreCleaning } from '../api';
import type { OfficeTask } from '../schema';

/**
 * A cleaning on the office's phone (owner, 2026-11-18): the office card — who
 * is on it, who gave it back and why, its steps read-only — and the office's
 * moves: «Назначить» / «Переназначить», «Отменить уборку», «Вернуть». Never the
 * cleaner's take, accept, start or finish. A push about a cleaning handed back
 * lands here. Everybody else keeps the cleaner's screen on the same route.
 */

let mockRole = 'manager';
/** Who holds the phone: the manager of the fixtures, or a cleaner. */
const mockPhone = { manager: 'c2d3e4f5-3333-4333-8333-c2d3e4f50001' };

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    userId: mockRole === 'cleaner' ? '7c9e6679-0000-4000-8000-00000000c1ea' : mockPhone.manager,
    isLoading: false,
    session: { user: { app_metadata: { role: mockRole } } },
  }),
}));

jest.mock('expo-router', () => ({
  Redirect: () => null,
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() },
  useLocalSearchParams: () => ({ id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b' }),
}));

jest.mock('@/features/knowledge/place-instructions', () => ({ PlaceInstructions: () => null }));

jest.mock('@/features/steps/use-steps', () => ({
  ...jest.requireActual<typeof import('@/features/steps/use-steps')>('@/features/steps/use-steps'),
  useTaskSteps: jest.fn(() => ({ data: undefined })),
}));

jest.mock('../api', () => ({
  fetchOfficeTask: jest.fn(),
  fetchOfficeTasks: jest.fn(),
  assignCleaning: jest.fn(),
  restoreCleaning: jest.fn(),
}));

jest.mock('@/features/tasks/api', () => ({
  fetchTask: jest.fn(),
  fetchMyTasks: jest.fn(),
  fetchFreeTasks: jest.fn(),
  fetchMyDoneTasks: jest.fn(),
  claimTask: jest.fn(),
  acceptTask: jest.fn(),
  startTask: jest.fn(),
  finishTask: jest.fn(),
  declineCleaning: jest.fn(),
  interruptCleaning: jest.fn(),
  cancelCleaning: jest.fn(),
}));

const CLEANER_GONE = 'f4a5b6c7-5555-4555-8555-f4a5b6c70001';

/** The company's people: two cleaners at work, one switched off, technicians. */
const PEOPLE: StaffMember[] = [
  ...STAFF,
  { id: CLEANER_VERA, full_name: 'Вера Новак', role: 'cleaner', is_active: true },
  { id: CLEANER_GONE, full_name: 'Ушедшая Горничная', role: 'cleaner', is_active: false },
];

jest.mock('@/features/board/use-board', () => ({
  ...jest.requireActual<typeof import('@/features/board/use-board')>('@/features/board/use-board'),
  useStaffDirectory: () => ({ data: mockPeople.list, error: null, refetch: jest.fn() }),
}));
const mockPeople: { list: StaffMember[] } = { list: [] };

/** Handed back by Vera this morning, nobody on it since. */
const HANDED_BACK = officeTask({
  status: 'unassigned',
  assignee_id: null,
  assignee: null,
  release_kind: 'declined',
  offs: {
    cancelled: null,
    released: {
      kind: 'declined',
      at: '2026-11-18T07:00:00+00:00',
      by: { id: CLEANER_VERA, name: 'Вера Новак', role: 'cleaner' },
      reason: 'Заболела',
    },
  },
});

/** Cancelled by the office, with its words. */
const CANCELLED = officeTask({
  status: 'cancelled',
  cancelled_at: '2026-11-18T09:40:00+00:00',
  offs: {
    cancelled: {
      at: '2026-11-18T09:40:00+00:00',
      from: 'assigned',
      by: { id: MANAGER, name: 'Пётр', role: 'manager' },
      reason: 'Гость продлил',
    },
    released: null,
  },
});

/** The cleaner's moves: none of them is ever the office's. */
const CLEANERS_MOVES = ['Взять', 'Принять', 'Начать уборку', 'Завершить уборку', 'Отказаться'];

function refusal(hint: string): Error {
  return Object.assign(new Error('refused'), { hint });
}

async function show(task: OfficeTask, role = 'manager'): Promise<void> {
  mockRole = role;
  jest.mocked(fetchOfficeTask).mockResolvedValue(task);
  jest.mocked(fetchTask).mockResolvedValue(task);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(<TaskRoute />, { wrapper: withClient(client) });
  expect(await screen.findByText('CZ - Nadrazni Apt 6')).toBeTruthy();
}

function buttons(): string[] {
  return screen.getAllByRole('button').map((button) => button.props.accessibilityLabel as string);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPeople.list = PEOPLE;
  jest
    .mocked(useTaskSteps)
    .mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useTaskSteps>);
  jest.mocked(assignCleaning).mockResolvedValue(undefined);
  jest.mocked(restoreCleaning).mockResolvedValue(undefined);
  jest.mocked(cancelCleaning).mockResolvedValue(undefined);
});

describe('a push about a cleaning handed back', () => {
  test.each(['cleaning_declined', 'cleaning_interrupted'] as const)(
    '%s lands on the cleaning itself',
    async (kind) => {
      await expect(destinationOf({ kind, taskId: TASK_ID }, jest.fn())).resolves.toEqual({
        pathname: '/task/[id]',
        params: { id: TASK_ID },
      });
    },
  );

  test.each(['manager', 'admin'])(
    'a %s lands on the office card: who gave it back and why, «Назначить», «Отменить уборку», never «Взять»',
    async (role) => {
      await show(HANDED_BACK, role);

      expect(screen.getByText('Отказ: Вера Новак')).toBeTruthy();
      expect(screen.getByText('«Заболела»')).toBeTruthy();
      expect(screen.getAllByText('Без исполнителя').length).toBeGreaterThan(0);
      expect(buttons()).toEqual(expect.arrayContaining(['Назначить', 'Отменить уборку', 'Чат']));
      for (const move of CLEANERS_MOVES) {
        expect(buttons()).not.toContain(move);
      }
    },
  );
});

describe('«Назначить»', () => {
  test('offers the cleaners at work, and sends the person and the day the card showed', async () => {
    await show(HANDED_BACK);

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));
    const sheet = within(screen.getByTestId('cleaner-sheet'));
    expect(sheet.getAllByRole('radio').map((row) => row.props.accessibilityLabel)).toEqual([
      'Анна Белова',
      'Вера Новак',
    ]);
    const send = () => sheet.getByRole('button', { name: 'Назначить' });
    expect(send().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(sheet.getByRole('radio', { name: 'Вера Новак' }));
    await fireEvent.press(send());

    await waitFor(() => expect(screen.queryByTestId('cleaner-sheet')).toBeNull());
    expect(assignCleaning).toHaveBeenCalledWith(
      { taskId: TASK_ID, assigneeId: CLEANER_VERA, shownDate: '2026-11-18' },
      expect.anything(),
    );
    // The card is read again once it lands.
    expect(jest.mocked(fetchOfficeTask).mock.calls.length).toBeGreaterThan(1);
  });

  test('on an assigned cleaning it is «Переназначить»; the one on it is marked and not sent again', async () => {
    await show(officeTask());

    expect(screen.getByText('Анна Белова')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Переназначить' }));
    const sheet = within(screen.getByTestId('cleaner-sheet'));
    await fireEvent.press(sheet.getByRole('radio', { name: 'Анна Белова, сейчас на уборке' }));

    expect(sheet.getByRole('button', { name: 'Назначить' }).props.accessibilityState).toMatchObject(
      { disabled: true },
    );
    expect(assignCleaning).not.toHaveBeenCalled();
  });

  test('a refusal stays on the sheet, in the reader’s words', async () => {
    jest.mocked(assignCleaning).mockRejectedValue(refusal('serverErrors.taskAssigneeInvalid'));
    await show(HANDED_BACK);

    await fireEvent.press(screen.getByRole('button', { name: 'Назначить' }));
    const sheet = within(screen.getByTestId('cleaner-sheet'));
    await fireEvent.press(sheet.getByRole('radio', { name: 'Вера Новак' }));
    await fireEvent.press(sheet.getByRole('button', { name: 'Назначить' }));

    expect(await sheet.findByText('Исполнитель не работает в этой компании')).toBeTruthy();
    expect(assignCleaning).toHaveBeenCalledTimes(1);
  });

  test('a finished cleaning offers neither an assignment nor a cancel', async () => {
    await show(officeTask({ status: 'done', completed_at: '2026-11-18T12:00:00+00:00' }));

    expect(buttons()).not.toContain('Переназначить');
    expect(buttons()).not.toContain('Назначить');
    expect(buttons()).toContain('Отменить уборку');
  });
});

describe('«Вернуть»', () => {
  test('a cleaning the office cancelled says who and why, and is returned once asked', async () => {
    await show(CANCELLED);

    expect(screen.getByText(/^Отмена: Пётр, /)).toBeTruthy();
    expect(screen.getByText('«Гость продлил»')).toBeTruthy();
    expect(buttons()).not.toContain('Отменить уборку');
    expect(buttons()).not.toContain('Переназначить');

    await fireEvent.press(screen.getByRole('button', { name: 'Вернуть' }));
    expect(restoreCleaning).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Да, вернуть' }));

    await waitFor(() => expect(restoreCleaning).toHaveBeenCalledWith(TASK_ID, expect.anything()));
  });

  test('a cleaning its booking cancelled is not the office’s to return', async () => {
    await show(officeTask({ status: 'cancelled', cancelled_at: null }));

    expect(buttons()).not.toContain('Вернуть');
  });
});

test('the steps are read in any status and open the read-only step screen', async () => {
  const step: TaskStep = {
    id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
    task_id: TASK_ID,
    sort_order: 1,
    type: 'confirmation',
    required: false,
    title: 'Финальная проверка',
    instructions: null,
    started_at: null,
    completed_at: '2026-11-18T11:00:00+00:00',
    completed_by: CLEANER_ANNA,
    title_i18n: {},
    instructions_i18n: {},
    config: {},
    min_photos: null,
    max_photos: null,
    max_video_sec: null,
    payload: {},
    skipped_at: null,
    skip_reason: null,
    waived_at: null,
    waive_reason: null,
  };
  jest
    .mocked(useTaskSteps)
    .mockReturnValue({ data: [step] } as unknown as ReturnType<typeof useTaskSteps>);
  await show(officeTask({ status: 'paused' }));

  await fireEvent.press(screen.getByRole('button', { name: /Финальная проверка/ }));

  expect(router.push).toHaveBeenCalledWith({
    pathname: '/task/[id]/step/[stepId]',
    params: { id: TASK_ID, stepId: step.id },
  });
});

test('a cleaner on the same route still gets her own screen: «Взять» on a free cleaning', async () => {
  await show(officeTask({ status: 'unassigned', assignee_id: null }), 'cleaner');

  expect(screen.getByRole('button', { name: 'Взять' })).toBeTruthy();
  expect(fetchOfficeTask).not.toHaveBeenCalled();
});
