import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { problemSchema, type Problem } from '../schema';

const problems: Problem[] = [
  problemSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    property_id: 1,
    task_id: null,
    reported_by: '22222222-2222-4222-8222-222222222222',
    title: 'Течёт кран',
    description: null,
    priority: 'high',
    status: 'open',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-09-09T10:00:00+00:00',
    property: { name: 'Vinohrady 12' },
    reporter: { full_name: 'Maria Test' },
    fix_tasks: [],
  }),
  problemSchema.parse({
    id: '33333333-3333-4333-8333-333333333333',
    property_id: 2,
    task_id: null,
    reported_by: '22222222-2222-4222-8222-222222222222',
    title: 'Сломан замок',
    description: null,
    priority: 'normal',
    status: 'assigned',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-09-08T10:00:00+00:00',
    property: { name: 'Karlín 3' },
    reporter: { full_name: 'Anna Test' },
    fix_tasks: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        assignee_id: '55555555-5555-4555-8555-555555555555',
        status: 'assigned',
        scheduled_date: '2026-09-10',
        time_from: null,
        time_to: null,
        assignee: { full_name: 'Petr Fixer' },
      },
    ],
  }),
];

const useProblems = vi.fn();
const idle = { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null };
vi.mock('../use-problems', () => ({
  useProblems: () => useProblems(),
  useResolveProblem: () => idle,
  useUnassignProblem: () => idle,
}));

import { ProblemsView } from '../problems-view';

describe('ProblemsView', () => {
  test('puts each problem into the column of its status and filters by search', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);

    const open = screen.getByRole('region', { name: 'Открыта' });
    const assigned = screen.getByRole('region', { name: 'Назначена' });
    expect(open).toHaveTextContent('Течёт кран');
    expect(assigned).toHaveTextContent('Сломан замок');
    expect(assigned).toHaveTextContent('Petr Fixer');

    await userEvent.type(screen.getByRole('searchbox'), 'karl');
    expect(screen.queryByText('Течёт кран')).not.toBeInTheDocument();
    expect(screen.getByText('Сломан замок')).toBeInTheDocument();
  });

  test('explains an empty section and a failed load', () => {
    useProblems.mockReturnValue({ data: [], isPending: false, isError: false });
    const { unmount } = render(<ProblemsView />);
    expect(screen.getByText('Проблем нет')).toBeInTheDocument();
    unmount();

    useProblems.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ProblemsView />);
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить проблемы');
  });
});
