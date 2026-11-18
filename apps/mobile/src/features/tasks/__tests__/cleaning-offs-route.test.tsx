import { dehydrate, type QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import TaskRoute from '@/app/task/[id]';
import { fetchOfficeTask } from '@/features/office/api';
import type { OfficeTask } from '@/features/office/schema';
import { officeKeys } from '@/features/office/use-office';
import { createAppQueryClient, persistOptions } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';

import { cancelCleaning, declineCleaning, fetchTask, interruptCleaning } from '../api';
import type { CleaningTask } from '../schema';

/**
 * A cleaning taken off from its own screen (20261118120000): she declines one
 * she has not started or interrupts one under way; the office cancels one.
 * Each is asked on the app's own sheet and sent at once or not at all — never
 * queued, never replayed — and a refusal is said on the sheet. Handed back,
 * the cleaning is no longer hers and the screen leaves it; cancelled, the
 * screen shows it closed.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const COLLEAGUE = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

const mockSession = {
  userId: ME,
  isLoading: false,
  session: { user: { app_metadata: { role: 'cleaner' } } },
};

jest.mock('@/features/auth/session', () => ({
  useSession: () => mockSession,
}));

jest.mock('expo-router', () => ({
  Redirect: () => null,
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() },
  useLocalSearchParams: () => ({ id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b' }),
}));

jest.mock('@/features/knowledge/place-instructions', () => ({
  PlaceInstructions: () => null,
}));

// The steps are a query of their own; the client still registers their moves.
jest.mock('@/features/steps/use-steps', () => ({
  ...jest.requireActual<typeof import('@/features/steps/use-steps')>('@/features/steps/use-steps'),
  useTaskSteps: () => ({ data: undefined }),
}));

jest.mock('../api', () => ({
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

// The office reads a cleaning on its own card (features/office), with its own read.
jest.mock('@/features/office/api', () => ({
  fetchOfficeTask: jest.fn(),
  fetchOfficeTasks: jest.fn(),
  assignCleaning: jest.fn(),
  restoreCleaning: jest.fn(),
}));

// The office card names the cleaners from the directory; none are needed here.
jest.mock('@/features/board/use-board', () => ({
  ...jest.requireActual<typeof import('@/features/board/use-board')>('@/features/board/use-board'),
  useStaffDirectory: () => ({ data: [], error: null, refetch: jest.fn() }),
}));

/** The cleaning as the office reads it: the same row, and nobody took it off. */
function asOffice(task: CleaningTask): OfficeTask {
  return { ...task, assignee: null, cancelled_at: null, release_kind: null, offs: null };
}

function cleaning(overrides: Partial<CleaningTask> = {}): CleaningTask {
  return {
    id: TASK_ID,
    status: 'assigned',
    priority: 0,
    scheduled_date: '2026-11-18',
    due_at: null,
    assignee_id: ME,
    property_id: 412432,
    reservation_id: 9001,
    problem_id: null,
    property: {
      name: 'CZ - Nadrazni Apt 6',
      address: 'Nádražní 6',
      hostaway_unit_id: null,
      effective_cleaner_notes: null,
      parent: null,
    },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: 2,
    started_at: null,
    completed_at: null,
    is_parallel: false,
    type: 'cleaning',
    notes: null,
    title: null,
    title_i18n: {},
    ...overrides,
  };
}

/** Under way: the moment an interrupt makes sense. */
function underWay(): CleaningTask {
  return cleaning({ status: 'in_progress', started_at: '2026-11-18T09:05:00+00:00' });
}

function refusal(hint: string): Error {
  return Object.assign(new Error('refused'), { hint });
}

/** The app's own client: the move runs on the production defaults, so its dispatch is its own. */
function appClient(): QueryClient {
  const queryClient = createAppQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false, gcTime: Infinity },
  });
  return queryClient;
}

/** The cleaning on screen, as the server answers it now: read when the screen opens. */
async function show(task: CleaningTask, role = 'cleaner'): Promise<QueryClient> {
  mockSession.session = { user: { app_metadata: { role } } };
  jest.mocked(fetchTask).mockResolvedValue(task);
  jest.mocked(fetchOfficeTask).mockResolvedValue(asOffice(task));
  const queryClient = appClient();
  await render(<TaskRoute />, { wrapper: withClient(queryClient) });
  expect(await screen.findByText('CZ - Nadrazni Apt 6')).toBeTruthy();
  return queryClient;
}

function sheet() {
  return within(screen.getByTestId('hand-back-sheet'));
}

async function open(button: string): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: button }));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(router.canGoBack).mockReturnValue(true);
  jest.mocked(declineCleaning).mockResolvedValue(undefined);
  jest.mocked(interruptCleaning).mockResolvedValue(undefined);
  jest.mocked(cancelCleaning).mockResolvedValue(undefined);
});

describe('her decline', () => {
  test('asks first, sends her words trimmed, and leaves the cleaning', async () => {
    await show(cleaning());

    await open('Отказаться');
    expect(declineCleaning).not.toHaveBeenCalled();
    await fireEvent.changeText(sheet().getByLabelText('Причина (необязательно)'), '  Заболела ');
    await fireEvent.press(sheet().getByRole('button', { name: 'Отказаться' }));

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(declineCleaning).toHaveBeenCalledTimes(1);
    expect(declineCleaning).toHaveBeenCalledWith(TASK_ID, 'Заболела');
    expect(screen.queryByTestId('hand-back-sheet')).toBeNull();
  });

  test('without a word of hers, sends no reason', async () => {
    await show(cleaning({ status: 'accepted' }));

    await open('Отказаться');
    await fireEvent.press(sheet().getByRole('button', { name: 'Отказаться' }));

    await waitFor(() => expect(declineCleaning).toHaveBeenCalledWith(TASK_ID, null));
  });

  test('opened cold from a push, with nothing behind, it leaves for her list', async () => {
    jest.mocked(router.canGoBack).mockReturnValue(false);
    await show(cleaning());

    await open('Отказаться');
    await fireEvent.press(sheet().getByRole('button', { name: 'Отказаться' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(tabs)'));
    expect(router.back).not.toHaveBeenCalled();
  });

  test('the cleanings are read again once it lands', async () => {
    await show(cleaning());
    const readsBefore = jest.mocked(fetchTask).mock.calls.length;

    await open('Отказаться');
    await fireEvent.press(sheet().getByRole('button', { name: 'Отказаться' }));

    await waitFor(() =>
      expect(jest.mocked(fetchTask).mock.calls.length).toBeGreaterThan(readsBefore),
    );
  });

  // On the app's own defaults a refused move would be tried again (lib/move-retry.ts).
  test('a refusal is said on the sheet, which stays; it is sent once and the screen stays', async () => {
    jest.mocked(declineCleaning).mockRejectedValue(refusal('serverErrors.taskChangedMeanwhile'));
    await show(cleaning());

    await open('Отказаться');
    await fireEvent.press(sheet().getByRole('button', { name: 'Отказаться' }));

    expect(await sheet().findByText('Это уже изменилось — экран обновлён')).toBeTruthy();
    expect(declineCleaning).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
  });

  test('without signal it fails at once and says so: nothing waits for the signal', async () => {
    jest.mocked(declineCleaning).mockRejectedValue(new TypeError('Network request failed'));
    const queryClient = await show(cleaning());

    await open('Отказаться');
    await fireEvent.press(sheet().getByRole('button', { name: 'Отказаться' }));

    expect(
      await sheet().findByText('Не удалось выполнить действие. Попробуйте ещё раз.'),
    ).toBeTruthy();
    expect(declineCleaning).toHaveBeenCalledTimes(1);
    expect(
      queryClient
        .getMutationCache()
        .getAll()
        .some((move) => move.state.isPaused),
    ).toBe(false);
  });

  test('on its way, it is never saved to disk to be replayed after a restart', async () => {
    jest.mocked(declineCleaning).mockReturnValue(new Promise<void>(() => undefined));
    const queryClient = await show(cleaning());

    await open('Отказаться');
    await fireEvent.press(sheet().getByRole('button', { name: 'Отказаться' }));

    await waitFor(() => expect(queryClient.isMutating()).toBe(1));
    expect(dehydrate(queryClient, persistOptions.dehydrateOptions).mutations).toEqual([]);
  });

  test('«Нет» sends nothing and keeps the cleaning on screen', async () => {
    await show(cleaning());

    await open('Отказаться');
    await fireEvent.press(sheet().getByRole('button', { name: 'Нет' }));

    expect(screen.queryByTestId('hand-back-sheet')).toBeNull();
    expect(declineCleaning).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('her interrupt', () => {
  test('waits for a reason, sends it trimmed, and leaves the cleaning', async () => {
    await show(underWay());

    await open('Прервать уборку');
    const confirm = () => sheet().getByRole('button', { name: 'Прервать' });
    expect(confirm().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(sheet().getByLabelText('Причина'), ' Нет воды ');
    await fireEvent.press(confirm());

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(interruptCleaning).toHaveBeenCalledWith(TASK_ID, 'Нет воды');
    expect(declineCleaning).not.toHaveBeenCalled();
  });

  test('the server’s own «reason required» is said on the sheet', async () => {
    jest.mocked(interruptCleaning).mockRejectedValue(refusal('serverErrors.reasonRequired'));
    await show(underWay());

    await open('Прервать уборку');
    await fireEvent.changeText(sheet().getByLabelText('Причина'), 'Нет воды');
    await fireEvent.press(sheet().getByRole('button', { name: 'Прервать' }));

    expect(await sheet().findByText('Укажите причину')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('the office’s cancel', () => {
  test.each(['manager', 'admin'])('a %s is offered it on anybody’s cleaning', async (role) => {
    await show(cleaning({ assignee_id: COLLEAGUE }), role);

    expect(screen.getByRole('button', { name: 'Отменить уборку' })).toBeTruthy();
  });

  test.each(['cleaner', 'tech', 'head_tech'])('a %s is not offered it', async (role) => {
    await show(cleaning(), role);

    expect(screen.queryByRole('button', { name: 'Отменить уборку' })).toBeNull();
  });

  test('sends the cancel, closes the sheet over the cleaning shown closed, and stays', async () => {
    const queryClient = await show(cleaning({ assignee_id: COLLEAGUE }), 'manager');
    jest
      .mocked(fetchOfficeTask)
      .mockResolvedValue(asOffice(cleaning({ assignee_id: COLLEAGUE, status: 'cancelled' })));

    await open('Отменить уборку');
    await fireEvent.changeText(
      sheet().getByLabelText('Причина (необязательно)'),
      ' Гость продлил ',
    );
    await fireEvent.press(sheet().getByRole('button', { name: 'Да, отменить' }));

    await waitFor(() => expect(screen.queryByTestId('hand-back-sheet')).toBeNull());
    expect(cancelCleaning).toHaveBeenCalledWith(TASK_ID, 'Гость продлил');
    expect(queryClient.getQueryData<OfficeTask>(officeKeys.one(TASK_ID))?.status).toBe(
      'cancelled',
    );
    expect(await screen.findByText('Отменена')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отменить уборку' })).toBeNull();
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  // The office's phone shows the office card (owner, 2026-11-18): the office
  // reassigns or cancels; it hands nothing back.
  test('a manager on her own cleaning gets the office card: the cancel, not a decline', async () => {
    await show(cleaning(), 'manager');

    expect(screen.getByRole('button', { name: 'Отменить уборку' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Переназначить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отказаться' })).toBeNull();
  });
});
