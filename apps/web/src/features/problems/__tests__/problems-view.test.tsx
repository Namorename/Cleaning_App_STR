import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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

const archived: Problem = problemSchema.parse({
  ...problems[0],
  id: '66666666-6666-4666-8666-666666666666',
  title: 'Тестовая заявка',
  status: 'resolved',
  resolved_at: '2026-09-08T12:00:00+00:00',
  archived_at: '2026-09-09T12:00:00+00:00',
});

const useProblems = vi.fn();
const unarchive = vi.fn();
const idle = { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null };
vi.mock('../use-problems', () => ({
  useProblems: () => useProblems(),
  useResolveProblem: () => idle,
  useUnassignProblem: () => idle,
  useReopenProblem: () => idle,
  useUnarchiveProblem: () => ({ ...idle, mutate: unarchive }),
}));

// The marks on the cards have their own test on the board; here the answer is empty.
vi.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set<string>(), problems: new Set<string>() }),
}));

// The router reads the address jsdom holds; the view writes it through
// history. «Назад» moves it a task later with `popstate`, as Next shows it.
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (onChange: () => void) => {
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  };
  return {
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
    usePathname: () => window.location.pathname,
  };
});

import { expectPageTitle } from '@/components/page-header.expect';

import { ProblemsView } from '../problems-view';

/** «Назад»: jsdom walks the history a task later and says so with `popstate`. */
function goBack(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.back();
  });
}

const selected = () =>
  screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true');

beforeEach(() => {
  window.history.pushState(null, '', '/problems');
});

describe('ProblemsView', () => {
  test('is headed by the common header, the search among its actions', () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);

    expectPageTitle('Задания');
    expect(
      screen.getByRole('heading', { level: 1 }).closest('[data-slot="page-header"]'),
    ).toContainElement(screen.getByRole('searchbox'));
  });

  test('the search and the tabs are 44 px targets', () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);

    expect(screen.getByRole('searchbox')).toHaveClass('h-11');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('min-h-11');
    }
  });

  test('keeps archived problems off the board and restores them from the archive tab', async () => {
    useProblems.mockReturnValue({
      data: [...problems, archived],
      isPending: false,
      isError: false,
    });
    render(<ProblemsView />);

    expect(screen.queryByText('Тестовая заявка')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Архив/ })).toHaveTextContent('1');

    await userEvent.click(screen.getByRole('tab', { name: /Архив/ }));
    expect(screen.getByText('Тестовая заявка')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Восстановить из архива' }));
    expect(unarchive).toHaveBeenCalledWith(archived.id);
  });

  test('puts each problem into the column of its status and filters by search', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);

    const open = screen.getByRole('region', { name: 'Открыто' });
    const assigned = screen.getByRole('region', { name: 'Назначено' });
    expect(open).toHaveTextContent('Течёт кран');
    expect(assigned).toHaveTextContent('Сломан замок');
    expect(assigned).toHaveTextContent('Petr Fixer');

    await userEvent.type(screen.getByRole('searchbox'), 'karl');
    expect(screen.queryByText('Течёт кран')).not.toBeInTheDocument();
    expect(screen.getByText('Сломан замок')).toBeInTheDocument();
  });

  test('keeps the columns when there is nothing in them, and explains a failed load', async () => {
    useProblems.mockReturnValue({ data: [], isPending: false, isError: false });
    const { unmount } = render(<ProblemsView />);
    expect(screen.getAllByRole('region')).toHaveLength(4);
    expect(screen.getAllByText('Заданий пока нет')).toHaveLength(4);
    await userEvent.type(screen.getByRole('searchbox'), 'x');
    expect(screen.getAllByText('Ничего не найдено')).toHaveLength(4);
    unmount();

    useProblems.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ProblemsView />);
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить задания');
  });
});

// Owner, 05.10: the view is in the address, a step «Назад» walks back; the
// page of a task returns to the view it was opened from.
describe('the view in the address', () => {
  test('a bare address is the board, and the view a link names opens', () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    const { unmount } = render(<ProblemsView />);
    expect(selected()).toHaveTextContent('Доска');
    unmount();

    window.history.pushState(null, '', '/problems?view=list');
    render(<ProblemsView />);
    expect(selected()).toHaveTextContent('Список');
  });

  test('a new view is a step «Назад» walks back', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);
    const steps = window.history.length;

    await userEvent.click(screen.getByRole('tab', { name: 'Список' }));
    expect(window.location.search).toBe('?view=list');
    expect(window.history.length).toBe(steps + 1);

    await act(() => goBack());
    expect(window.location.search).toBe('');
    expect(selected()).toHaveTextContent('Доска');
  });

  test('each view’s link to a task carries the view back', async () => {
    useProblems.mockReturnValue({
      data: [...problems, archived],
      isPending: false,
      isError: false,
    });
    render(<ProblemsView />);
    const board = within(screen.getByRole('region', { name: 'Открыто' }));
    expect(board.getByRole('link', { name: 'Течёт кран' })).toHaveAttribute(
      'href',
      `/problems/${problems[0].id}`,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Список' }));
    expect(screen.getByRole('link', { name: 'Течёт кран' })).toHaveAttribute(
      'href',
      `/problems/${problems[0].id}?view=list`,
    );

    await userEvent.click(screen.getByRole('tab', { name: /Архив/ }));
    expect(screen.getByRole('link', { name: 'Тестовая заявка' })).toHaveAttribute(
      'href',
      `/problems/${archived.id}?view=archive`,
    );
  });
});
