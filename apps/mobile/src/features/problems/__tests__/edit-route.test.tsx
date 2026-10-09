import { fireEvent, render, screen } from '@testing-library/react-native';

import EditProblemRoute from '@/app/problem/[id]/edit';

import type { Problem } from '../schema';
import { useProblem } from '../use-problems';

/**
 * Correcting an open report: the form starts from the row once, then belongs
 * to her fingers. Pinned here because the way it does so changed (a state
 * set during render instead of in an effect) and must not change what she
 * sees.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const PROBLEM_ID = 'd1e2f3a4-1111-4111-8111-d1e2f3a40001';

const mockParams: { id: string } = { id: PROBLEM_ID };
const mockSession: { userId: string | null } = { userId: ME };

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => mockSession,
}));

beforeEach(() => {
  mockParams.id = PROBLEM_ID;
  mockSession.userId = ME;
});

jest.mock('../use-problems', () => ({
  useProblem: jest.fn(),
  useUpdateProblem: () => ({
    mutate: jest.fn(),
    isPending: false,
    isPaused: false,
    isSuccess: false,
    error: null,
  }),
}));

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: PROBLEM_ID,
    property_id: 412432,
    task_id: null,
    reported_by: ME,
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

function answer(data: Problem | undefined): void {
  jest.mocked(useProblem).mockReturnValue({ data } as ReturnType<typeof useProblem>);
}

test('a report that arrives after the screen opened fills the form', async () => {
  // Arrange: nothing yet.
  answer(undefined);
  const view = await render(<EditProblemRoute />);
  // Said as loading: the label of the skeleton that stands in.
  expect(screen.getByRole('progressbar', { name: 'Загружаем задания…' })).toBeTruthy();

  // Act: the row arrives.
  answer(problem());
  await view.rerender(<EditProblemRoute />);

  // Assert
  expect(screen.getByDisplayValue('Кран течёт')).toBeTruthy();
});

test('what she typed survives the report being fetched again under her', async () => {
  // Arrange
  answer(problem());
  const view = await render(<EditProblemRoute />);
  await fireEvent.changeText(screen.getByDisplayValue('Кран течёт'), 'Кран течёт сильно');

  // Act: a refetch hands over a new copy of the row.
  answer(problem({ title: 'Кран течёт', description: 'обновлено' }));
  await view.rerender(<EditProblemRoute />);

  // Assert
  expect(screen.getByDisplayValue('Кран течёт сильно')).toBeTruthy();
});

describe('the wrapper on the «Абрикос» components', () => {
  test('while the report loads, its shape stands in for the form, said as loading', async () => {
    answer(undefined);

    await render(<EditProblemRoute />);

    const loading = screen.getByRole('progressbar', { name: 'Загружаем задания…' });
    expect(loading.props.accessibilityState).toMatchObject({ busy: true });
  });

  test('a report that could not load says why instead of loading for ever', async () => {
    jest.mocked(useProblem).mockReturnValue({
      data: undefined,
      error: new Error('Network request failed'),
    } as ReturnType<typeof useProblem>);

    await render(<EditProblemRoute />);

    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });

  test('a report that is not there says so', async () => {
    jest.mocked(useProblem).mockReturnValue({ data: null } as ReturnType<typeof useProblem>);

    await render(<EditProblemRoute />);

    expect(screen.getByText('Задание не найдено')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  // A disabled query (no id to ask for, nobody to ask as) never loads: TanStack
  // reports it pending for ever, and the skeleton would stand there as long.
  test('a link without a valid id says not found, not loading for ever', async () => {
    mockParams.id = 'not-a-uuid';
    answer(undefined);

    await render(<EditProblemRoute />);

    expect(screen.getByText('Задание не найдено')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  test('before she is known, the report is not found, not loading for ever', async () => {
    mockSession.userId = null;
    answer(undefined);

    await render(<EditProblemRoute />);

    expect(screen.getByText('Задание не найдено')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  test('a report taken into work says it can no longer be changed', async () => {
    answer(problem({ status: 'assigned' }));

    await render(<EditProblemRoute />);

    expect(screen.getByText('Задание уже взяли в работу — изменить его нельзя')).toBeTruthy();
    expect(screen.queryByDisplayValue('Кран течёт')).toBeNull();
  });
});
