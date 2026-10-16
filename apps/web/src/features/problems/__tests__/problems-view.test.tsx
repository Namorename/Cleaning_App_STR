import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
// «Новое задание»: the write as the dialog sees it. `report` answers the way
// the mutation's own callbacks would, with the row the server hands back.
const report = vi.fn();
const reportState: { isPending: boolean; isError: boolean; error: unknown } = {
  isPending: false,
  isError: false,
  error: null,
};
vi.mock('../use-problems', () => ({
  useProblems: () => useProblems(),
  useResolveProblem: () => idle,
  useUnassignProblem: () => idle,
  useReopenProblem: () => idle,
  useUnarchiveProblem: () => ({ ...idle, mutate: unarchive }),
  useReportProblem: () => ({ ...reportState, mutate: report }),
}));

// The listings the new task can stand on: the same reader «Уборки» use.
const listings = [
  {
    id: 1,
    name: 'Vinohrady 12',
    parent_id: null,
    hostaway_unit_id: null,
    status: 'active',
    timezone: 'Europe/Prague',
  },
  {
    id: 2,
    name: 'Karlín 3',
    parent_id: null,
    hostaway_unit_id: null,
    status: 'active',
    timezone: 'Europe/Prague',
  },
];
vi.mock('@/features/tasks/use-tasks', () => ({ useProperties: () => ({ data: listings }) }));

// The marks come from one company-wide answer; here it is a pair of sets the
// test fills by hand. The board's own marks are tested on the board.
const unread = { tasks: new Set<string>(), problems: new Set<string>() };
vi.mock('@/features/chat/use-chat', () => ({ useUnreadSubjects: () => unread }));

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
    useRouter: () => ({ push }),
  };
});
const push = vi.fn();

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
  unread.problems.clear();
  report.mockReset();
  push.mockReset();
  reportState.isPending = false;
  reportState.isError = false;
  reportState.error = null;
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

// The owner, 09.10: signed in as a manager, he found no way to create a task.
// The panel never had one — «Новое задание» of F10 was the cleanings' form,
// «Новая уборка» since the rename of 27.09 — so «Задания» gets its own, in
// the header beside the search, writing through report_problem as the phone does.
describe('a new task', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  async function openForm() {
    await userEvent.click(screen.getByRole('button', { name: 'Новое задание' }));
    return screen.findByRole('dialog', { name: 'Новое задание' });
  }

  /** A form ready to send: a listing chosen on purpose and what happened named. */
  async function fillForm(form: HTMLElement, place = 'Vinohrady 12') {
    await userEvent.selectOptions(within(form).getByLabelText('Объект'), place);
    await userEvent.type(within(form).getByLabelText('Что случилось'), 'Течёт кран');
  }

  /** Who a task can be handed to depends on its listing: «Без объекта» says so. */
  const NO_LISTING_HINT = 'Задание без объекта нельзя передать технику';

  test('the header offers «Новое задание», a 44 px target, on every view', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);

    const button = screen.getByRole('button', { name: 'Новое задание' });
    expect(button.closest('[data-slot="page-header"]')).not.toBeNull();
    expect(button).toHaveClass('h-11');

    await userEvent.click(screen.getByRole('tab', { name: /Архив/ }));
    expect(screen.getByRole('button', { name: 'Новое задание' })).toBeInTheDocument();
  });

  test('is there while the list is still loading or failed to load', () => {
    useProblems.mockReturnValue({ data: undefined, isPending: true, isError: false });
    const { unmount } = render(<ProblemsView />);
    expect(screen.getByRole('button', { name: 'Новое задание' })).toBeInTheDocument();
    unmount();

    useProblems.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ProblemsView />);
    expect(screen.getByRole('button', { name: 'Новое задание' })).toBeInTheDocument();
  });

  test('writes the task with an id of its own, then opens its page', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    report.mockImplementation((variables, options) =>
      options?.onSuccess?.({ id: variables.problemId }),
    );
    render(<ProblemsView />);
    const form = await openForm();

    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Karlín 3');
    await userEvent.type(within(form).getByLabelText('Что случилось'), '  Сломан замок  ');
    await userEvent.type(within(form).getByLabelText('Подробности'), 'Входная дверь');
    await userEvent.selectOptions(within(form).getByLabelText('Срочность'), 'Высокая');
    await userEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    expect(report).toHaveBeenCalledTimes(1);
    const [variables] = report.mock.calls[0];
    expect(variables).toEqual({
      problemId: expect.stringMatching(UUID),
      title: 'Сломан замок',
      description: 'Входная дверь',
      priority: 'high',
      propertyId: 2,
    });
    expect(push).toHaveBeenCalledWith(`/problems/${variables.problemId}`);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('a task with no listing goes out as one, at the usual priority, when chosen so', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    window.history.pushState(null, '', '/problems?view=list');
    render(<ProblemsView />);
    report.mockImplementation((variables, options) =>
      options?.onSuccess?.({ id: variables.problemId }),
    );
    const form = await openForm();

    expect(within(form).getByLabelText('Срочность')).toHaveDisplayValue('Обычная');
    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Без объекта');
    await userEvent.type(within(form).getByLabelText('Что случилось'), 'Купить стремянку');
    await userEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    const [variables] = report.mock.calls[0];
    expect(variables).toMatchObject({ description: '', priority: 'normal', propertyId: null });
    // The page returns to the view the task was created from.
    expect(push).toHaveBeenCalledWith(`/problems/${variables.problemId}?view=list`);
  });

  // The reviewer, 10.10: a silent «Без объекта» made a task nobody can be
  // sent to — assign_problem refuses one with no listing (problemNoProperty).
  test('no listing is chosen for the manager: one is picked on purpose, «Без объекта» too', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);
    const form = await openForm();
    const listing = within(form).getByLabelText('Объект');
    const create = within(form).getByRole('button', { name: 'Создать' });

    expect(listing).toHaveDisplayValue('Выберите объект');
    await userEvent.type(within(form).getByLabelText('Что случилось'), 'Течёт кран');
    expect(create).toBeDisabled();

    await userEvent.selectOptions(listing, 'Без объекта');
    expect(create).toBeEnabled();
  });

  test('«Без объекта» says such a task cannot be handed to a technician', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);
    const form = await openForm();
    const listing = within(form).getByLabelText('Объект');

    expect(within(form).queryByText(new RegExp(NO_LISTING_HINT))).not.toBeInTheDocument();
    // The form promises a technician only for a task with a listing.
    expect(form).toHaveAccessibleDescription(/задание с объектом можно назначить технику/);

    await userEvent.selectOptions(listing, 'Без объекта');
    expect(listing).toHaveAccessibleDescription(new RegExp(NO_LISTING_HINT));

    await userEvent.selectOptions(listing, 'Karlín 3');
    expect(within(form).queryByText(new RegExp(NO_LISTING_HINT))).not.toBeInTheDocument();
  });

  test('«Создать» waits for what happened to be named', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);
    const form = await openForm();
    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Vinohrady 12');

    const create = within(form).getByRole('button', { name: 'Создать' });
    expect(create).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('Что случилось'), '   ');
    expect(create).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('Что случилось'), 'Течёт кран');
    expect(create).toBeEnabled();
  });

  // The reviewer, 10.10: closed while the write was on its way, the form took
  // its callback with it — the task was made, no page opened, and a second
  // opening minted a new id for the same task typed again.
  describe('while the task is on its way', () => {
    beforeEach(() => {
      reportState.isPending = true;
    });

    // Escape and a press outside reach the form the same way (onOpenChange);
    // jsdom has no outside press to give, so Escape stands for both.
    test('«Отмена» is off and Escape does not close the form', async () => {
      useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
      render(<ProblemsView />);
      const form = await openForm();

      expect(within(form).getByRole('button', { name: 'Отмена' })).toBeDisabled();
      expect(within(form).getByRole('button', { name: 'Создаём…' })).toBeDisabled();
      await userEvent.keyboard('{Escape}');

      expect(screen.getByRole('dialog', { name: 'Новое задание' })).toBeInTheDocument();
    });
  });

  test('once the write has settled, Escape closes the form again', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);
    await openForm();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('a press repeated after a refusal sends the same id', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);
    const form = await openForm();
    await fillForm(form);

    await userEvent.click(within(form).getByRole('button', { name: 'Создать' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1][0].problemId).toBe(report.mock.calls[0][0].problemId);
  });

  test('a refusal is said in the manager’s words, and what was typed stays', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    reportState.isError = true;
    reportState.error = {
      message: 'The title is longer than 200 characters',
      hint: 'serverErrors.problemTitleTooLong',
      details: '{"limit":200}',
    };
    render(<ProblemsView />);
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText('Что случилось'), 'Течёт кран');

    const alert = within(form).getByRole('alert');
    expect(alert).not.toHaveTextContent('The title is longer');
    expect(alert).toHaveTextContent('200');
    expect(within(form).getByLabelText('Что случилось')).toHaveValue('Течёт кран');
    expect(push).not.toHaveBeenCalled();
  });

  test('«Отмена» closes the form and sends nothing', async () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText('Что случилось'), 'Течёт кран');

    await userEvent.click(within(form).getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(report).not.toHaveBeenCalled();
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

  test('a view the address does not know opens the board', () => {
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    window.history.pushState(null, '', '/problems?view=bogus');

    render(<ProblemsView />);

    expect(selected()).toHaveTextContent('Доска');
    expect(screen.getByRole('region', { name: 'Открыто' })).toBeInTheDocument();
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

// 10.10, the owner: the tasks' section needs filters by listing, by assignee
// and by date. One bar for the board, the list and the archive.
describe('the filters', () => {
  const KARLIN = 'Karl%C3%ADn+3';
  const PETR = '55555555-5555-4555-8555-555555555555';

  beforeEach(() => {
    useProblems.mockReturnValue({
      data: [...problems, archived],
      isPending: false,
      isError: false,
    });
  });

  const titles = () => screen.queryAllByRole('link').map((link) => link.textContent);

  test('a listing narrows the board, the list and the archive, the archive’s count too', async () => {
    render(<ProblemsView />);

    await userEvent.selectOptions(screen.getByLabelText('Объект'), 'Karlín 3');

    expect(titles()).toEqual(['Сломан замок']);
    expect(screen.getByRole('tab', { name: /Архив/ })).toHaveTextContent('0');
    await userEvent.click(screen.getByRole('tab', { name: 'Список' }));
    expect(titles()).toEqual(['Сломан замок']);
    await userEvent.click(screen.getByRole('tab', { name: /Архив/ }));
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
  });

  test('a person keeps what he holds, «Не назначено» what nobody holds', async () => {
    render(<ProblemsView />);

    await userEvent.selectOptions(screen.getByLabelText('Исполнитель'), 'Petr Fixer');
    expect(titles()).toEqual(['Сломан замок']);

    await userEvent.selectOptions(screen.getByLabelText('Исполнитель'), 'Не назначено');
    expect(titles()).toEqual(['Течёт кран']);
  });

  test('the dates keep the tasks reported between them', () => {
    render(<ProblemsView />);

    fireEvent.change(screen.getByLabelText('Заявлено с'), { target: { value: '2026-09-09' } });
    expect(titles()).toEqual(['Течёт кран']);

    fireEvent.change(screen.getByLabelText('Заявлено с'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Заявлено по'), { target: { value: '2026-09-08' } });
    expect(titles()).toEqual(['Сломан замок']);
  });

  test('nothing left says so, and «Сбросить фильтры» brings it all back, the search too', async () => {
    render(<ProblemsView />);

    await userEvent.type(screen.getByRole('searchbox'), 'karl');
    await userEvent.selectOptions(screen.getByLabelText('Исполнитель'), 'Не назначено');
    expect(screen.getAllByText('Ничего не найдено')).toHaveLength(4);

    await userEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(titles()).toEqual(['Течёт кран', 'Сломан замок']);
    expect(window.location.search).toBe('');
  });

  // Owner, 04.10, for «Уборки»: a filter is changed in place, a view is a step.
  test('a filter goes into the address in place, and a task’s link carries it there and back', async () => {
    render(<ProblemsView />);
    const steps = window.history.length;

    await userEvent.selectOptions(screen.getByLabelText('Объект'), 'Karlín 3');

    expect(window.location.search).toBe(`?place=${KARLIN}`);
    expect(window.history.length).toBe(steps);
    expect(screen.getByRole('link', { name: 'Сломан замок' })).toHaveAttribute(
      'href',
      `/problems/${problems[1].id}?place=${KARLIN}`,
    );
  });

  test('«Назад» from the next view returns to the filtered one', async () => {
    render(<ProblemsView />);

    await userEvent.selectOptions(screen.getByLabelText('Исполнитель'), 'Petr Fixer');
    await userEvent.click(screen.getByRole('tab', { name: 'Список' }));
    expect(window.location.search).toBe(`?view=list&assignee=${PETR}`);

    await act(() => goBack());
    expect(window.location.search).toBe(`?assignee=${PETR}`);
    expect(selected()).toHaveTextContent('Доска');
    expect(screen.getByLabelText('Исполнитель')).toHaveDisplayValue('Petr Fixer');
    expect(titles()).toEqual(['Сломан замок']);
  });

  test('a link with filters opens the screen filtered', () => {
    window.history.pushState(null, '', '/problems?view=list&assignee=nobody');

    render(<ProblemsView />);

    expect(selected()).toHaveTextContent('Список');
    expect(screen.getByLabelText('Исполнитель')).toHaveDisplayValue('Не назначено');
    expect(titles()).toEqual(['Течёт кран']);
  });

  test('a place or a person no task names is set aside, not shown as an empty screen', () => {
    window.history.pushState(
      null,
      '',
      '/problems?place=Nowhere+1&assignee=99999999-9999-4999-8999-999999999999',
    );

    render(<ProblemsView />);

    expect(screen.getByLabelText('Объект')).toHaveDisplayValue('Любой объект');
    expect(screen.getByLabelText('Исполнитель')).toHaveDisplayValue('Любой исполнитель');
    expect(screen.queryByRole('button', { name: 'Сбросить фильтры' })).not.toBeInTheDocument();
    expect(titles()).toEqual(['Течёт кран', 'Сломан замок']);
  });

  // The review of 2981da8..db36705: such a link emptied the board.
  test('a link whose dates are the wrong way round keeps the days between them', () => {
    window.history.pushState(null, '', '/problems?from=2026-09-09&to=2026-09-08');

    render(<ProblemsView />);

    expect(screen.getByLabelText('Заявлено с')).toHaveValue('2026-09-08');
    expect(screen.getByLabelText('Заявлено по')).toHaveValue('2026-09-09');
    expect(titles()).toEqual(['Течёт кран', 'Сломан замок']);
  });
});

// 10.10, the owner: the page must not grow without end, and old tasks stay
// within reach — «Показать ещё» on «Выполнено», the list and the archive.
describe('a page at a time', () => {
  const MINUTE_MS = 60 * 1000;

  /** `count` tasks, newest reported first as the server reads them; «N» resolved later the larger N. */
  function many(count: number, patch: (n: number) => Record<string, unknown>): Problem[] {
    return Array.from({ length: count }, (_, index) => {
      const n = index + 1;
      return problemSchema.parse({
        ...problems[0],
        id: `77777777-0000-4000-8000-${String(n).padStart(12, '0')}`,
        title: `Лампа ${n}`,
        created_at: new Date(Date.UTC(2026, 8, 30) - n * MINUTE_MS).toISOString(),
        ...patch(n),
      });
    });
  }

  const resolvedAt = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * MINUTE_MS).toISOString();

  test('the filters narrow «Выполнено» first, then it shows the newest of what is left', async () => {
    const resolved = many(25, (n) => ({
      status: 'resolved',
      resolved_at: resolvedAt(n),
      property: { name: n % 2 === 1 ? 'Karlín 3' : 'Vinohrady 12' },
    }));
    useProblems.mockReturnValue({ data: resolved, isPending: false, isError: false });
    render(<ProblemsView />);

    await userEvent.selectOptions(screen.getByLabelText('Объект'), 'Karlín 3');

    const done = within(screen.getByRole('region', { name: 'Выполнено' }));
    expect(done.getByText('13')).toBeInTheDocument();
    expect(done.getAllByRole('article')).toHaveLength(10);
    expect(done.getAllByRole('link').map((link) => link.textContent)).toEqual(
      [25, 23, 21, 19, 17, 15, 13, 11, 9, 7].map((n) => `Лампа ${n}`),
    );
    expect(done.getByRole('button', { name: 'Показать ещё 3 (всего 13)' })).toBeInTheDocument();
  });

  test('the list shows fifty rows, newest reported first, and fifty more each press', async () => {
    useProblems.mockReturnValue({
      data: many(60, () => ({})),
      isPending: false,
      isError: false,
    });
    window.history.pushState(null, '', '/problems?view=list');
    render(<ProblemsView />);

    const rows = () => screen.getAllByRole('link', { name: /^Лампа / });
    expect(rows()).toHaveLength(50);
    expect(rows()[0]).toHaveTextContent('Лампа 1');

    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё 10 (всего 60)' }));
    expect(rows()).toHaveLength(60);
    expect(screen.getByRole('link', { name: 'Лампа 51' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).toBeNull();
  });

  test('the archive shows twenty, and twenty more each press', async () => {
    useProblems.mockReturnValue({
      data: many(25, () => ({ archived_at: '2026-10-02T10:00:00+00:00' })),
      isPending: false,
      isError: false,
    });
    window.history.pushState(null, '', '/problems?view=archive');
    render(<ProblemsView />);

    const rows = () => screen.getAllByRole('link', { name: /^Лампа / });
    expect(rows()).toHaveLength(20);
    expect(screen.getByRole('tab', { name: /Архив/ })).toHaveTextContent('25');

    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё 5 (всего 25)' }));
    expect(rows()).toHaveLength(25);
    expect(screen.getByRole('link', { name: 'Лампа 21' })).toHaveFocus();
  });

  // The review of 2981da8..db36705: «Выполнено» opened to thirty stayed at
  // thirty through a filter and back. Each new set of filters starts a page anew.
  test('a change of the filters or the search starts «Выполнено» on its first page again', async () => {
    const resolved = many(45, (n) => ({
      status: 'resolved',
      resolved_at: resolvedAt(n),
      property: { name: n % 2 === 1 ? 'Karlín 3' : 'Vinohrady 12' },
    }));
    useProblems.mockReturnValue({ data: resolved, isPending: false, isError: false });
    render(<ProblemsView />);
    const done = () => within(screen.getByRole('region', { name: 'Выполнено' }));

    await userEvent.click(done().getByRole('button', { name: 'Показать ещё 20 (всего 45)' }));
    expect(done().getAllByRole('article')).toHaveLength(30);

    await userEvent.selectOptions(screen.getByLabelText('Объект'), 'Karlín 3');
    expect(done().getAllByRole('article')).toHaveLength(10);
    await userEvent.click(done().getByRole('button', { name: 'Показать ещё 13 (всего 23)' }));
    expect(done().getAllByRole('article')).toHaveLength(23);

    await userEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(done().getAllByRole('article')).toHaveLength(10);
    expect(done().getByRole('button', { name: 'Показать ещё 20 (всего 45)' })).toBeInTheDocument();

    await userEvent.click(done().getByRole('button', { name: 'Показать ещё 20 (всего 45)' }));
    await userEvent.type(screen.getByRole('searchbox'), 'Лампа');
    expect(done().getAllByRole('article')).toHaveLength(10);
  });

  test('a change of the filters starts the list on its first page again', async () => {
    useProblems.mockReturnValue({
      data: many(60, (n) => ({ property: { name: n <= 55 ? 'Karlín 3' : 'Vinohrady 12' } })),
      isPending: false,
      isError: false,
    });
    window.history.pushState(null, '', '/problems?view=list');
    render(<ProblemsView />);
    const rows = () => screen.getAllByRole('link', { name: /^Лампа / });

    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё 10 (всего 60)' }));
    expect(rows()).toHaveLength(60);

    await userEvent.selectOptions(screen.getByLabelText('Объект'), 'Karlín 3');
    expect(rows()).toHaveLength(50);
    expect(screen.getByRole('button', { name: 'Показать ещё 5 (всего 55)' })).toBeInTheDocument();
  });
});

// 5.4, «Чат»: the mark of an unread message stood on the board's cards only.
describe('the mark of an unread message', () => {
  /** The mark's name: the words, then whose conversation it opens. */
  const MARK = /^Новое сообщение — открыть чат: /;

  test('stands beside the title in the list, and leads to the conversation', async () => {
    unread.problems.add(problems[1].id);
    useProblems.mockReturnValue({ data: problems, isPending: false, isError: false });
    render(<ProblemsView />);

    await userEvent.click(screen.getByRole('tab', { name: 'Список' }));

    const marked = screen.getByRole('link', { name: 'Сломан замок' }).closest('tr') as HTMLElement;
    expect(within(marked).getByRole('link', { name: MARK })).toHaveAttribute(
      'href',
      `/problems/${problems[1].id}?view=list&chat=1`,
    );
    expect(within(marked).getByRole('link', { name: MARK })).toHaveAccessibleName(
      'Новое сообщение — открыть чат: Сломан замок',
    );
    // The title still opens the page itself.
    expect(within(marked).getByRole('link', { name: 'Сломан замок' })).toHaveAttribute(
      'href',
      `/problems/${problems[1].id}?view=list`,
    );
    const other = screen.getByRole('link', { name: 'Течёт кран' }).closest('tr') as HTMLElement;
    expect(within(other).queryByRole('link', { name: MARK })).not.toBeInTheDocument();
  });

  test('stands beside the title in the archive too', async () => {
    unread.problems.add(archived.id);
    useProblems.mockReturnValue({
      data: [...problems, archived],
      isPending: false,
      isError: false,
    });
    render(<ProblemsView />);

    await userEvent.click(screen.getByRole('tab', { name: /Архив/ }));

    expect(screen.getByRole('link', { name: MARK })).toHaveAttribute(
      'href',
      `/problems/${archived.id}?view=archive&chat=1`,
    );
    expect(screen.getByRole('link', { name: 'Тестовая заявка' })).toHaveAttribute(
      'href',
      `/problems/${archived.id}?view=archive`,
    );
  });
});
