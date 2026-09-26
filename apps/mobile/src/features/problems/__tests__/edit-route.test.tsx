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

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40001' }),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

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
  expect(screen.getByText('Загружаем проблемы…')).toBeTruthy();

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
