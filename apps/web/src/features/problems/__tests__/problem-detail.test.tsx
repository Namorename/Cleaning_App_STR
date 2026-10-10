import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';

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
  reopen: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
};
const idle = {
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
};

/** A refused cancel, kept until the mutation is reset — as TanStack keeps it. */
const refusal = { cancel: false };
const cancelOutcome = () => ({
  isError: refusal.cancel,
  error: refusal.cancel ? { hint: 'serverErrors.taskChangedMeanwhile' } : null,
  reset: () => {
    refusal.cancel = false;
  },
});

vi.mock('../use-problems', () => ({
  useProblem: () => queries.problem(),
  useProblemPhotos: () => queries.photos(),
  useFixTaskSteps: () => queries.steps(),
  useStaff: () => queries.staff(),
  useAssignProblem: () => ({ ...idle, mutate: mutations.assign }),
  useCancelProblem: () => ({ ...idle, ...cancelOutcome(), mutate: mutations.cancel }),
  useResolveProblem: () => ({ ...idle, mutate: mutations.resolve }),
  useReopenProblem: () => ({ ...idle, mutate: mutations.reopen }),
  useArchiveProblem: () => ({ ...idle, mutate: mutations.archive }),
  useUnarchiveProblem: () => ({ ...idle, mutate: mutations.unarchive }),
}));

// The conversation has its own tests; here it only has to open, say what it
// is about and close.
vi.mock('@/features/chat/chat-sheet', () => ({
  ChatSheet: (props: { subject: Record<string, string>; about: string; onClose: () => void }) => (
    <div role="dialog" aria-label="Чат">
      {`${Object.values(props.subject).join(',')} · ${props.about}`}
      <button type="button" onClick={props.onClose}>
        Закрыть
      </button>
    </div>
  ),
}));

// The marks come from one company-wide answer; here it is a pair of sets the
// test fills by hand.
const unread = { tasks: new Set<string>(), problems: new Set<string>() };
vi.mock('@/features/chat/use-chat', () => ({ useUnreadSubjects: () => unread }));

// The router reads the address jsdom holds; the page writes it through
// history, which jsdom keeps as a browser would. «Назад» moves it a task later
// with `popstate`, and the router shows the page again — as Next does.
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

import { ICONS } from '@str-ops/shared';

import { expectPageTitle } from '@/components/page-header.expect';

import { ProblemDetail } from '../problem-detail';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false });

/** The query of the page's address, without its `?`. */
const query = () => window.location.search.slice(1);

/** «Назад»: jsdom walks the history a task later and says so with `popstate`. */
function goBack(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.back();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', `/problems/${PROBLEM_ID}`);
  unread.problems.clear();
  refusal.cancel = false;
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
      mediaByStep: {},
    }),
  );
  queries.staff.mockReturnValue(
    loaded([
      { id: TECH_ID, full_name: 'Petr Fixer', role: 'cleaner' },
      { id: '99999999-9999-4999-8999-999999999999', full_name: 'Anna Test', role: 'cleaner' },
    ]),
  );
});

/** Opens the header's «⋯» and hands back the menu. */
async function openMoreActions(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: 'Другие действия' }));
  return screen.findByRole('menu');
}

const header = () =>
  screen.getByRole('heading', { level: 1 }).closest('[data-slot="problem-head"]') as HTMLElement;

describe('ProblemDetail', () => {
  test('«К списку заданий» returns to the view the task was opened from', () => {
    window.history.replaceState(null, '', `/problems/${PROBLEM_ID}?view=list`);
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(screen.getByRole('link', { name: 'К списку заданий' })).toHaveAttribute(
      'href',
      '/problems?view=list',
    );
  });

  // 10.10: a task opened from a filtered view returns to it, filters and all.
  test('«К списку заданий» returns to the filtered view the task was opened from', () => {
    window.history.replaceState(
      null,
      '',
      `/problems/${PROBLEM_ID}?view=list&place=Karl%C3%ADn+3&assignee=nobody`,
    );
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(screen.getByRole('link', { name: 'К списку заданий' })).toHaveAttribute(
      'href',
      '/problems?view=list&place=Karl%C3%ADn+3&assignee=nobody',
    );
  });

  test('is headed by the common header, with the way back to the list', () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expectPageTitle('Течёт кран');
    expect(screen.getByRole('link', { name: 'К списку заданий' })).toHaveAttribute(
      'href',
      '/problems',
    );
  });

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

  // The status of the technician's job read a key no dictionary has, and the
  // manager saw the raw code: «Статус задачи: assigned».
  test('says the status of the technician’s job in words, not as a code', () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(screen.getByText('Статус работы: Назначена')).toBeInTheDocument();
    expect(screen.queryByText(/: assigned$/)).toBeNull();
  });

  // 5.4, variant A (docs/design/decisions.md §2): the levers were at the foot
  // of the right card, under the steps; now they head the page and stay there.
  test('keeps the title, the status and the actions in a header that stays on screen', () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(header()).toHaveClass('md:sticky');
    expect(header()).toHaveTextContent('Назначено');
    expect(
      within(header()).getByRole('button', { name: 'Отметить выполненным' }),
    ).toBeInTheDocument();
    expect(within(header()).getByRole('button', { name: 'Другие действия' })).toBeInTheDocument();
  });

  test('sets the technician’s work beside the report, with no levers under its steps', () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    const work = screen.getByText('Работа техника').closest('[data-slot="card"]') as HTMLElement;
    expect(work.parentElement).toHaveClass('lg:grid-cols-2');
    expect(within(work).queryByRole('button', { name: 'Отметить выполненным' })).toBeNull();
    expect(within(work).getByRole('button', { name: 'Переназначить' })).toBeInTheDocument();
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

  // «Отметить выполненным», «Отменить задание» and «Удалить в архив» stood
  // side by side: the dangerous two now wait in the menu, after a separator.
  test('keeps the dangerous actions away from «Отметить выполненным»', async () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(screen.queryByRole('button', { name: 'Отменить задание' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить в архив' })).toBeNull();

    const menu = await openMoreActions();
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Отменить задание', 'Удалить в архив']);
    expect(items[1]).toHaveAttribute('data-variant', 'destructive');
  });

  test('resolves at once and cancels only after a confirmation with a reason', async () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Отметить выполненным' }));
    expect(mutations.resolve).toHaveBeenCalledWith(PROBLEM_ID);

    const menu = await openMoreActions();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Отменить задание' }));
    const question = await screen.findByRole('dialog', { name: 'Отменить задание' });
    expect(mutations.cancel).not.toHaveBeenCalled();
    await userEvent.type(within(question).getByLabelText('Причина отмены'), 'Дубликат');
    await userEvent.click(within(question).getByRole('button', { name: 'Подтвердить отмену' }));
    expect(mutations.cancel).toHaveBeenCalledWith(
      { problemId: PROBLEM_ID, reason: 'Дубликат' },
      expect.anything(),
    );
  }, 20000);

  test('«Не отменять» closes the question and cancels nothing', async () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    const menu = await openMoreActions();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Отменить задание' }));
    const question = await screen.findByRole('dialog', { name: 'Отменить задание' });
    await userEvent.click(within(question).getByRole('button', { name: 'Не отменять' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mutations.cancel).not.toHaveBeenCalled();
  }, 20000);

  test('offers to reopen a closed problem instead of the live levers, and explains a missing one', async () => {
    queries.problem.mockReturnValue(
      loaded({ ...assigned, status: 'resolved', resolved_at: '2026-09-10T12:00:00+00:00' }),
    );
    const { unmount } = render(<ProblemDetail problemId={PROBLEM_ID} />);
    expect(screen.queryByRole('button', { name: 'Отметить выполненным' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Техник')).not.toBeInTheDocument();
    const menu = await openMoreActions();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Удалить в архив']);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть в работу' }));
    expect(mutations.reopen).toHaveBeenCalledWith(PROBLEM_ID);
    unmount();

    queries.problem.mockReturnValue(loaded(null));
    render(<ProblemDetail problemId={PROBLEM_ID} />);
    expect(screen.getByText('Задание не найдено')).toBeInTheDocument();
  }, 20000);

  test('archives only after a confirmation and restores an archived problem', async () => {
    const { unmount } = render(<ProblemDetail problemId={PROBLEM_ID} />);

    const menu = await openMoreActions();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Удалить в архив' }));
    const question = await screen.findByRole('dialog', { name: 'Удалить в архив' });
    expect(mutations.archive).not.toHaveBeenCalled();
    expect(question).toHaveTextContent(/Ничего не удаляется/);
    await userEvent.click(within(question).getByRole('button', { name: 'Да, в архив' }));
    expect(mutations.archive).toHaveBeenCalledWith(PROBLEM_ID, expect.anything());
    unmount();

    queries.problem.mockReturnValue(
      loaded({
        ...assigned,
        status: 'open',
        fix_tasks: [],
        archived_at: '2026-09-10T12:00:00+00:00',
      }),
    );
    render(<ProblemDetail problemId={PROBLEM_ID} />);
    expect(screen.getByText(/В архиве с/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отметить выполненным' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Другие действия' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Техник')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Восстановить из архива' }));
    expect(mutations.unarchive).toHaveBeenCalledWith(PROBLEM_ID);
  }, 20000);

  // The line under the actions showed the first mutation that had failed: a
  // refused cancel stayed there after «Отметить выполненным» went through.
  test('a new action clears the refusal an earlier one left', async () => {
    refusal.cancel = true;
    const { rerender } = render(<ProblemDetail problemId={PROBLEM_ID} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Это уже изменилось — экран обновлён');

    await userEvent.click(screen.getByRole('button', { name: 'Отметить выполненным' }));
    rerender(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(mutations.resolve).toHaveBeenCalledWith(PROBLEM_ID);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('every control of the page is a 44 px target', () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(screen.getByRole('button', { name: 'Чат' })).toHaveClass('h-11');
    expect(screen.getByRole('button', { name: 'Отметить выполненным' })).toHaveClass('h-11');
    expect(screen.getByRole('button', { name: 'Другие действия' })).toHaveClass('size-11');
    expect(screen.getByRole('button', { name: 'Переназначить' })).toHaveClass('h-11');
    for (const label of ['Техник', 'Дата', 'С', 'До']) {
      expect(screen.getByLabelText(label)).toHaveClass('h-11');
    }
  });
});

// 5.4, «Чат», variant B: the conversation was a card at the foot of the page,
// under the fold; now it slides in beside the task from the header.
describe('the conversation of a task', () => {
  const chatButton = () => within(header()).getByRole('button', { name: /^Чат/ });

  test('is no card on the page, but a button in the header with its picture and name', () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Чат' })).not.toBeInTheDocument();
    expect(chatButton()).toHaveAccessibleName('Чат');
    expect(chatButton().querySelector('svg')).toHaveClass(`lucide-${ICONS['action.openChat']}`);
    expect(chatButton().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('opens by the button as a step, about the task, and closing walks that step back', async () => {
    window.history.pushState(null, '', `/problems/${PROBLEM_ID}?view=list`);
    render(<ProblemDetail problemId={PROBLEM_ID} />);
    const steps = window.history.length;

    await userEvent.click(chatButton());

    expect(query()).toBe('view=list&chat=1');
    expect(window.history.length).toBe(steps + 1);
    // About the task, whichever technician fixes it.
    const sheet = screen.getByRole('dialog', { name: 'Чат' });
    expect(sheet).toHaveTextContent(`${PROBLEM_ID} · Течёт кран`);

    // «Назад» after it must not open it again: the close is the step back.
    const walkedBack = new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true }),
    );
    await userEvent.click(within(sheet).getByRole('button', { name: 'Закрыть' }));
    await act(() => walkedBack);

    expect(query()).toBe('view=list');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('a link with the conversation in it opens the page with it open; closing takes it out in place', async () => {
    window.history.pushState(null, '', `/problems/${PROBLEM_ID}?view=archive&chat=1`);
    render(<ProblemDetail problemId={PROBLEM_ID} />);
    const steps = window.history.length;
    const popstate = vi.fn();
    window.addEventListener('popstate', popstate);
    onTestFinished(() => window.removeEventListener('popstate', popstate));

    const sheet = screen.getByRole('dialog', { name: 'Чат' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Закрыть' }));

    // Nothing behind it to walk back to: the page came with it open.
    expect(query()).toBe('view=archive');
    expect(window.history.length).toBe(steps);
    expect(popstate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'К списку заданий' })).toHaveAttribute(
      'href',
      '/problems?view=archive',
    );
  });

  // The review of 05.10: the close hid the sheet and waited for «Назад» to land.
  // When it never does — the step was taken by another tab, or «Вперёд» came
  // first — the sheet stayed hidden with `chat=1` in the address, and the next
  // press pushed a second `chat=1`. Then the address is set right in place.
  test('a close whose step back never lands takes the conversation out in place', async () => {
    window.history.pushState(null, '', `/problems/${PROBLEM_ID}?view=list`);
    render(<ProblemDetail problemId={PROBLEM_ID} />);
    await userEvent.click(chatButton());
    const steps = window.history.length;
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    onTestFinished(() => back.mockRestore());

    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Чат' })).getByRole('button', {
        name: 'Закрыть',
      }),
    );

    await waitFor(() => expect(query()).toBe('view=list'));
    expect(window.history.length).toBe(steps);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(chatButton());
    expect(query()).toBe('view=list&chat=1');
    expect(window.history.length).toBe(steps + 1);
    expect(screen.getByRole('dialog', { name: 'Чат' })).toBeInTheDocument();
  });

  test('«Назад» while it is open closes it', async () => {
    window.history.pushState(null, '', `/problems/${PROBLEM_ID}`);
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    await userEvent.click(chatButton());
    expect(screen.getByRole('dialog', { name: 'Чат' })).toBeInTheDocument();

    await act(() => goBack());

    expect(query()).toBe('');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('the button carries the mark of a message the manager has not read', () => {
    unread.problems.add(PROBLEM_ID);
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(chatButton()).toHaveAccessibleName('Чат Новое сообщение');
    expect(within(chatButton()).getByText('Новое сообщение')).toHaveClass('bg-tone-unread-mark');
  });
});
