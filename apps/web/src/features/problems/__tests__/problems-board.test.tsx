import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { problemSchema, type Problem } from '../schema';

const OPEN_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNED_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const TECH_ID = '55555555-5555-4555-8555-555555555555';

const base = {
  property_id: 1,
  task_id: null,
  reported_by: '22222222-2222-4222-8222-222222222222',
  description: null,
  priority: 'normal',
  resolved_at: null,
  cancelled_at: null,
  cancel_reason: null,
  created_at: '2026-09-09T10:00:00+00:00',
  property: { name: 'Vinohrady 12' },
  reporter: { full_name: 'Maria Test' },
};

const problems: Problem[] = [
  problemSchema.parse({ ...base, id: OPEN_ID, title: 'Течёт кран', status: 'open', fix_tasks: [] }),
  problemSchema.parse({
    ...base,
    id: ASSIGNED_ID,
    title: 'Сломан замок',
    status: 'assigned',
    fix_tasks: [
      {
        id: TASK_ID,
        assignee_id: TECH_ID,
        status: 'assigned',
        scheduled_date: '2026-09-10',
        time_from: null,
        time_to: null,
        assignee: { full_name: 'Petr Fixer' },
      },
    ],
  }),
];

const mutations = { resolve: vi.fn(), unassign: vi.fn(), assign: vi.fn() };
const idle = { isPending: false, isError: false, isSuccess: false, error: null };

vi.mock('../use-problems', () => ({
  useResolveProblem: () => ({ ...idle, mutate: mutations.resolve }),
  useUnassignProblem: () => ({ ...idle, mutate: mutations.unassign }),
  useAssignProblem: () => ({ ...idle, mutate: mutations.assign }),
  useStaff: () => ({
    data: [{ id: TECH_ID, full_name: 'Petr Fixer', role: 'cleaner' }],
    isPending: false,
    isError: false,
  }),
}));

import { ProblemsBoard } from '../problems-board';

const column = (name: string) => screen.getByRole('region', { name });
const card = (title: string) => screen.getByRole('link', { name: new RegExp(title) });

function dragTo(title: string, columnName: string) {
  const target = column(columnName);
  fireEvent.dragStart(card(title));
  fireEvent.dragEnter(target);
  fireEvent.dragOver(target);
  fireEvent.drop(target);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProblemsBoard drag and drop', () => {
  test('only live cards are draggable', () => {
    render(<ProblemsBoard problems={problems} />);
    expect(card('Течёт кран')).toHaveAttribute('draggable', 'true');
  });

  test('dropping an assigned card on "open" cancels the technician task', () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Сломан замок', 'Открыта');

    expect(mutations.unassign).toHaveBeenCalledWith(TASK_ID, expect.anything());
  });

  test('dropping on "resolved" asks first and resolves on confirmation', async () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Течёт кран', 'Решена');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/«Течёт кран» закроется как решённая/)).toBeInTheDocument();
    expect(mutations.resolve).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, решена' }));
    expect(mutations.resolve).toHaveBeenCalledWith(OPEN_ID, expect.anything());
  });

  test('dropping an open card on "assigned" opens the technician form', async () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Течёт кран', 'Назначена');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Назначить техника')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Техник')).toBeInTheDocument();
  });

  test('"in progress" explains that the technician starts the task', () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Течёт кран', 'В работе');

    expect(screen.getByRole('status')).toHaveTextContent(
      'В работу проблему переводит техник, начав задачу в приложении',
    );
    expect(mutations.resolve).not.toHaveBeenCalled();
    expect(mutations.unassign).not.toHaveBeenCalled();
  });
});
