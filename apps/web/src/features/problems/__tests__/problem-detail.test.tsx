import { render, screen, within } from '@testing-library/react';
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
  reopen: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
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
  useReopenProblem: () => ({ ...idle, mutate: mutations.reopen }),
  useArchiveProblem: () => ({ ...idle, mutate: mutations.archive }),
  useUnarchiveProblem: () => ({ ...idle, mutate: mutations.unarchive }),
}));

// The conversation has its own tests; here it only has to be in the card.
vi.mock('@/features/chat/thread-panel', () => ({
  ThreadPanel: ({ subject }: { subject: Record<string, string> }) => (
    <section aria-label="Разговор">{Object.values(subject).join(',')}</section>
  ),
}));

import { expectPageTitle } from '@/components/page-header.expect';

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

/** Opens the header's «⋯» and hands back the menu. */
async function openMoreActions(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: 'Другие действия' }));
  return screen.findByRole('menu');
}

const header = () =>
  screen.getByRole('heading', { level: 1 }).closest('[data-slot="problem-head"]') as HTMLElement;

describe('ProblemDetail', () => {
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
    // The conversation is about the problem, whichever task fixes it.
    expect(screen.getByRole('region', { name: 'Разговор' })).toHaveTextContent(PROBLEM_ID);
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

  test('every control of the page is a 44 px target', () => {
    render(<ProblemDetail problemId={PROBLEM_ID} />);

    expect(screen.getByRole('button', { name: 'Отметить выполненным' })).toHaveClass('h-11');
    expect(screen.getByRole('button', { name: 'Другие действия' })).toHaveClass('size-11');
    expect(screen.getByRole('button', { name: 'Переназначить' })).toHaveClass('h-11');
    for (const label of ['Техник', 'Дата', 'С', 'До']) {
      expect(screen.getByLabelText(label)).toHaveClass('h-11');
    }
  });
});
