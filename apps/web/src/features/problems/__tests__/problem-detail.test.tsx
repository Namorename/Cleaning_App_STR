import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { problemSchema, type Problem } from '../schema';

const PROBLEM_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const TECH_ID = '55555555-5555-4555-8555-555555555555';
const STEP_ID = '66666666-6666-4666-8666-666666666666';

const assigned: Problem = problemSchema.parse({
  id: PROBLEM_ID,
  property_id: 1,
  task_id: null,
  reported_by: '22222222-2222-4222-8222-222222222222',
  title: 'Течёт кран',
  description: 'На кухне, под мойкой',
  priority: 'high',
  status: 'assigned',
  resolved_at: null,
  cancelled_at: null,
  cancel_reason: null,
  created_at: '2026-09-09T10:00:00+00:00',
  property: { name: 'Vinohrady 12' },
  reporter: { full_name: 'Maria Test' },
  fix_tasks: [
    {
      id: TASK_ID,
      assignee_id: TECH_ID,
      status: 'assigned',
      scheduled_date: '2026-09-10',
      time_from: '09:00:00',
      time_to: '12:00:00',
      assignee: { full_name: 'Petr Fixer' },
    },
  ],
});

const queries = {
  problem: vi.fn(),
  photos: vi.fn(),
  steps: vi.fn(),
  staff: vi.fn(),
};
const mutations = {
  assign: vi.fn(),
  cancel: vi.fn(),
  resolve: vi.fn(),
};
const idle = { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null };

vi.mock('../use-problems', () => ({
  useProblem: () => queries.problem(),
  useProblemPhotos: () => queries.photos(),
  useFixTaskSteps: () => queries.steps(),
  useStaff: () => queries.staff(),
  useAssignProblem: () => ({ ...idle, mutate: mutations.assign }),
  useCancelProblem: () => ({ ...idle, mutate: mutations.cancel }),
  useResolveProblem: () => ({ ...idle, mutate: mutations.resolve }),
}));

import { ProblemDetail } from '../problem-detail';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false });

beforeEach(() => {
  vi.clearAllMocks();
  queries.problem.mockReturnValue(loaded(assigned));
  queries.photos.mockReturnValue(
    loaded([
      {
        id: '77777777-7777-4777-8777-777777777777',
        step_id: null,
        storage_path: 'h/problems/p/1.jpg',
        created_at: '2026-09-09T10:01:00+00:00',
        url: 'https://storage.example/1.jpg?token=x',
      },
    ]),
  );
  queries.steps.mockReturnValue(
    loaded({
      steps: [
        {
          id: STEP_ID,
          sort_order: 1,
          type: 'photos_before',
          required: true,
          title: 'Фото проблемы',
          title_i18n: { en: 'Photos of the problem' },
          completed_at: '2026-09-10T09:30:00+00:00',
          skipped_at: null,
          waived_at: null,
        },
        {
          id: '88888888-8888-4888-8888-888888888888',
          sort_order: 2,
          type: 'cleaner_comment',
          required: true,
          title: 'Что было сделано?',
          title_i18n: null,
          completed_at: null,
          skipped_at: null,
          waived_at: null,
        },
      ],
      photosByStep: {},
    }),
  );
  queries.staff.mockReturnValue(
    loaded([
      { id: TECH_ID, full_name: 'Petr Fixer', role: 'cleaner' },
      { id: '99999999-9999-4999-8999-999999999999', full_name: 'Anna Test', role: 'cleaner' },
    ]),
  );
});

describe('ProblemDetail', () => {
  test('shows the report, its photo, the technician, the window and the steps', () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Течёт кран' })).toBeInTheDocument();
    expect(screen.getByText('На кухне, под мойкой')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Фото 1' })).toHaveAttribute(
      'src',
      'https://storage.example/1.jpg?token=x',
    );
    expect(screen.getByText('Petr Fixer', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/09:00–12:00/)).toBeInTheDocument();
    expect(screen.getByText('1. Фото проблемы')).toBeInTheDocument();
    expect(screen.getByText('Выполнен')).toBeInTheDocument();
    expect(screen.getByText('Не выполнен')).toBeInTheDocument();
  });

  test('reassigns with the chosen person, date and window', async () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    await userEvent.selectOptions(screen.getByLabelText('Техник'), 'Anna Test');
    await userEvent.click(screen.getByRole('button', { name: 'Переназначить' }));

    expect(mutations.assign).toHaveBeenCalledWith(
      {
        problemId: PROBLEM_ID,
        assigneeId: '99999999-9999-4999-8999-999999999999',
        scheduledDate: '2026-09-10',
        timeFrom: '09:00',
        timeTo: '12:00',
      },
      expect.anything(),
    );
  });

  test('resolves at once and cancels only after a confirmation with a reason', async () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Отметить решённой' }));
    expect(mutations.resolve).toHaveBeenCalledWith(PROBLEM_ID);

    await userEvent.click(screen.getByRole('button', { name: 'Отменить проблему' }));
    expect(mutations.cancel).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Причина отмены'), 'Дубликат');
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену' }));
    expect(mutations.cancel).toHaveBeenCalledWith({ problemId: PROBLEM_ID, reason: 'Дубликат' });
  });

  test('hides the levers on a closed problem and explains a missing one', () => {
    queries.problem.mockReturnValue(
      loaded({ ...assigned, status: 'resolved', resolved_at: '2026-09-10T12:00:00+00:00' }),
    );
    const { unmount } = render(<ProblemDetail problemId={PROBLEM_ID} />);
    expect(screen.queryByRole('button', { name: 'Отметить решённой' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Техник')).not.toBeInTheDocument();
    unmount();

    queries.problem.mockReturnValue(loaded(null));
    render(<ProblemDetail problemId={PROBLEM_ID} />);
    expect(screen.getByText('Проблема не найдена')).toBeInTheDocument();
  });
});
