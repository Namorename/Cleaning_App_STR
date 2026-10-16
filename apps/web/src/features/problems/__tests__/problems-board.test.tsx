import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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

const RESOLVED_ID = '77777777-7777-4777-8777-777777777777';
const resolved: Problem = problemSchema.parse({
  ...base,
  id: RESOLVED_ID,
  title: 'Перегорела лампа',
  status: 'resolved',
  resolved_at: '2026-09-09T12:00:00+00:00',
  fix_tasks: [],
});

const mutations = { resolve: vi.fn(), unassign: vi.fn(), assign: vi.fn(), reopen: vi.fn() };
const resets = { resolve: vi.fn(), unassign: vi.fn(), reopen: vi.fn() };
const idle = { isPending: false, isError: false, isSuccess: false, error: null };

/** What a mutation last ended in, kept until it is reset — as TanStack keeps it. */
const quiet = () => ({ isPending: false, isError: false, error: null as unknown });
const outcome = { resolve: quiet(), unassign: quiet() };

vi.mock('../use-problems', () => ({
  useResolveProblem: () => ({
    ...idle,
    ...outcome.resolve,
    mutate: mutations.resolve,
    reset: () => {
      resets.resolve();
      outcome.resolve = quiet();
    },
  }),
  useUnassignProblem: () => ({
    ...idle,
    ...outcome.unassign,
    mutate: mutations.unassign,
    reset: () => {
      resets.unassign();
      outcome.unassign = quiet();
    },
  }),
  useAssignProblem: () => ({ ...idle, mutate: mutations.assign }),
  useReopenProblem: () => ({ ...idle, mutate: mutations.reopen, reset: resets.reopen }),
  useStaff: () => ({
    data: [{ id: TECH_ID, full_name: 'Petr Fixer', role: 'cleaner' }],
    isPending: false,
    isError: false,
  }),
}));

// The marks come from one company-wide answer; here it is a pair of sets the
// test fills by hand.
const unread = { tasks: new Set<string>(), problems: new Set<string>() };
vi.mock('@/features/chat/use-chat', () => ({ useUnreadSubjects: () => unread }));

afterEach(() => {
  unread.problems.clear();
});

import { ProblemsBoard } from '../problems-board';
import { useBoardMoves } from '../use-board-moves';

const column = (name: string) => screen.getByRole('region', { name });
const card = (title: string) => screen.getByRole('article', { name: title });

/** Opens a card's «⋯» and hands back what it offers. */
async function openCardMenu(title: string): Promise<HTMLElement> {
  await userEvent.click(within(card(title)).getByRole('button', { name: `Действия: ${title}` }));
  return screen.findByRole('menu');
}

const itemsOf = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);

/**
 * A drag as a browser makes it: over the column, a drop only where the column
 * accepted the card, and the dragend that always closes it.
 */
function dragTo(title: string, columnName: string) {
  const dragged = card(title);
  const target = column(columnName);
  fireEvent.dragStart(dragged);
  fireEvent.dragEnter(target);
  fireEvent.dragOver(target);
  if (target.getAttribute('data-droppable') === 'true') {
    fireEvent.drop(target);
  }
  fireEvent.dragEnd(dragged);
}

beforeEach(() => {
  vi.clearAllMocks();
  outcome.resolve = quiet();
  outcome.unassign = quiet();
});

/** The words a refused drag leaves under the board (owner, 05.10). */
const DRAG_REFUSED =
  'Так перетащить нельзя: перевести карточку можно через её меню «⋯», а в работу задание берёт техник в приложении';

// Owner, 05.10: the mouse is an addition to the menu «⋯», and makes two moves
// only — the two a manager makes most: hand an open task to a technician, and
// take one back. Everything else is the menu's, or the technician's.
describe('ProblemsBoard drag and drop', () => {
  test('only live cards are draggable', () => {
    render(<ProblemsBoard problems={problems} />);
    expect(card('Течёт кран')).toHaveAttribute('draggable', 'true');
  });

  test('while a card is dragged, only the column it may go to is lit', () => {
    render(<ProblemsBoard problems={problems} />);

    fireEvent.dragStart(card('Течёт кран'));
    const lit = screen
      .getAllByRole('region')
      .filter((region) => region.getAttribute('data-droppable') === 'true')
      .map((region) => region.getAttribute('aria-label'));
    expect(lit).toEqual(['Назначено']);
    fireEvent.dragEnd(card('Течёт кран'));

    fireEvent.dragStart(card('Сломан замок'));
    expect(column('Открыто')).toHaveAttribute('data-droppable', 'true');
    expect(column('Выполнено')).not.toHaveAttribute('data-droppable', 'true');
    expect(column('В работе')).not.toHaveAttribute('data-droppable', 'true');
  });

  // The review of 05.10: a faint ring (below 3:1) was the only sign, so the
  // column got a dashed outline in the primary colour. The words «Можно сюда»
  // that came with it are gone at the owner's word of 05.10: the outline says it.
  test('the column a card may go to is outlined plainly, without words', () => {
    render(<ProblemsBoard problems={problems} />);

    fireEvent.dragStart(card('Течёт кран'));

    expect(column('Назначено')).toHaveClass('outline-2', 'outline-dashed', 'outline-primary');
    expect(column('Выполнено')).not.toHaveClass('outline-dashed');
    expect(screen.queryByText('Можно сюда')).toBeNull();
  });

  describe('«Открыто» → «Назначено»', () => {
    test('opens the technician form, and the choice assigns the task', async () => {
      render(<ProblemsBoard problems={problems} />);

      dragTo('Течёт кран', 'Назначено');
      const dialog = await screen.findByRole('dialog', { name: 'Назначить техника' });
      await userEvent.selectOptions(within(dialog).getByLabelText('Техник'), 'Petr Fixer');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Назначить' }));

      expect(mutations.assign).toHaveBeenCalledWith(
        expect.objectContaining({ problemId: OPEN_ID, assigneeId: TECH_ID }),
        expect.anything(),
      );
    }, 20000);

    test('a cancelled choice leaves the card where it was', async () => {
      render(<ProblemsBoard problems={problems} />);

      dragTo('Течёт кран', 'Назначено');
      await screen.findByRole('dialog', { name: 'Назначить техника' });
      await userEvent.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mutations.assign).not.toHaveBeenCalled();
      expect(within(column('Открыто')).getByRole('article', { name: 'Течёт кран' })).toBeVisible();
    });
  });

  describe('«Назначено» → «Открыто»', () => {
    test('asks first, then takes off the person the card shows', async () => {
      render(<ProblemsBoard problems={problems} />);

      dragTo('Сломан замок', 'Открыто');
      const question = await screen.findByRole('dialog', { name: 'Снять техника с работы?' });
      expect(question).toHaveTextContent('Petr Fixer больше не будет видеть «Сломан замок»');
      expect(mutations.unassign).not.toHaveBeenCalled();

      await userEvent.click(within(question).getByRole('button', { name: 'Снять' }));
      expect(mutations.unassign).toHaveBeenCalledWith(
        { taskId: TASK_ID, assigneeId: TECH_ID },
        expect.anything(),
      );
    });

    test('«Оставить» leaves the technician on the job', async () => {
      render(<ProblemsBoard problems={problems} />);

      dragTo('Сломан замок', 'Открыто');
      const question = await screen.findByRole('dialog', { name: 'Снять техника с работы?' });
      await userEvent.click(within(question).getByRole('button', { name: 'Оставить' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mutations.unassign).not.toHaveBeenCalled();
    });
  });

  describe('every other drop is refused, in words', () => {
    const inProgress: Problem = problemSchema.parse({
      ...base,
      id: '88888888-8888-4888-8888-888888888888',
      title: 'Меняют стекло',
      status: 'in_progress',
      fix_tasks: [
        {
          id: '99999999-9999-4999-8999-999999999990',
          assignee_id: TECH_ID,
          status: 'in_progress',
          scheduled_date: '2026-09-10',
          time_from: null,
          time_to: null,
          assignee: { full_name: 'Petr Fixer' },
        },
      ],
    });

    test.each([
      ['Течёт кран', 'Выполнено'],
      ['Течёт кран', 'В работе'],
      ['Сломан замок', 'В работе'],
      ['Сломан замок', 'Выполнено'],
      ['Меняют стекло', 'Открыто'],
      ['Перегорела лампа', 'Открыто'],
      ['Перегорела лампа', 'Назначено'],
    ])('«%s» onto «%s» stays put, and the line says where it is done', (title, target) => {
      render(<ProblemsBoard problems={[...problems, inProgress, resolved]} />);

      dragTo(title, target);

      expect(screen.queryByRole('dialog')).toBeNull();
      for (const mutate of Object.values(mutations)) {
        expect(mutate).not.toHaveBeenCalled();
      }
      expect(screen.getByRole('status')).toHaveTextContent(DRAG_REFUSED);
    });
  });

  // A browser drops nothing on a column that did not accept the card: the
  // drag just ends there, and that is when the line has to speak.
  test('a card let go over a column it may not enter stays, and the line says why', () => {
    render(<ProblemsBoard problems={problems} />);

    fireEvent.dragStart(card('Течёт кран'));
    fireEvent.dragEnter(column('Выполнено'));
    fireEvent.dragEnd(card('Течёт кран'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(DRAG_REFUSED);
  });

  test('passing over a closed column on the way to the open one says nothing', async () => {
    render(<ProblemsBoard problems={problems} />);
    // Taken before the drop: the form it opens hides the board from queries.
    const dragged = card('Течёт кран');

    fireEvent.dragStart(dragged);
    fireEvent.dragEnter(column('Выполнено'));
    fireEvent.dragEnter(column('Назначено'));
    fireEvent.dragOver(column('Назначено'));
    fireEvent.drop(column('Назначено'));
    fireEvent.dragEnd(dragged);

    expect(await screen.findByRole('dialog', { name: 'Назначить техника' })).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent(DRAG_REFUSED);
  });

  // A stale screen makes "take the technician off" fail routinely
  // (serverErrors.taskChangedMeanwhile). The status line shows the first
  // failed mutation, so an old refusal must not outlive the next action.
  test('every drop clears the outcome an earlier action left', () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Течёт кран', 'Выполнено');

    expect(resets.resolve).toHaveBeenCalled();
    expect(resets.unassign).toHaveBeenCalled();
    expect(resets.reopen).toHaveBeenCalled();
  });

  test('marks the breakage somebody wrote about, and no other', () => {
    unread.problems.add(OPEN_ID);
    render(<ProblemsBoard problems={problems} />);

    expect(within(card('Течёт кран')).getByText('Новое сообщение')).toBeInTheDocument();
    expect(within(card('Сломан замок')).queryByText('Новое сообщение')).not.toBeInTheDocument();
  });
});

// 5.4, «Задания» variant A (docs/design/decisions.md §2; the page's «Доска — частично»).
describe('ProblemsBoard layout', () => {
  test('keeps four columns side by side, the board scrolling sideways when the screen is narrow', () => {
    const { container } = render(<ProblemsBoard problems={problems} />);

    expect(
      screen.getAllByRole('region').map((region) => region.getAttribute('aria-label')),
    ).toEqual(['Открыто', 'Назначено', 'В работе', 'Выполнено']);
    const grid = container.querySelector('[data-slot="problems-board"]');
    expect(grid).toHaveClass('grid-cols-[repeat(4,minmax(16rem,1fr))]');
    expect(grid?.parentElement).toHaveClass('overflow-x-auto');
  });

  // «Назначено» and «В работе» were one black pill: now each column is headed
  // in its status's tone and glyph, so they differ in colour and in shape.
  test('heads each column in its status’s tone and glyph', () => {
    render(<ProblemsBoard problems={problems} />);

    const head = (name: string) => within(column(name)).getByText(name);
    expect(head('Назначено')).toHaveClass('bg-tone-assigned-bg');
    expect(head('Назначено').querySelector('svg')).toHaveAttribute('fill', 'currentColor');
    expect(head('В работе')).toHaveClass('bg-tone-in-progress-bg');
    expect(head('В работе').querySelector('svg')).toHaveClass('lucide-play');
    expect(head('Открыто').querySelector('svg')).toHaveAttribute('stroke-dasharray');
  });

  test('a card is compact: title, place, the technician and the day', () => {
    render(<ProblemsBoard problems={problems} />);

    const assigned = card('Сломан замок');
    expect(assigned).toHaveTextContent('Vinohrady 12');
    expect(assigned).toHaveTextContent('Petr Fixer · 10.09');
    expect(within(assigned).getByRole('link', { name: 'Сломан замок' })).toHaveAttribute(
      'href',
      `/problems/${ASSIGNED_ID}`,
    );
  });

  // «Обычная» on every card was noise: urgency speaks only when it is not the usual.
  test('says the urgency only when it is not «Обычная»', () => {
    const urgent = problemSchema.parse({
      ...base,
      id: '88888888-8888-4888-8888-888888888888',
      title: 'Нет воды',
      priority: 'high',
      status: 'open',
      fix_tasks: [],
    });
    render(<ProblemsBoard problems={[...problems, urgent]} />);

    expect(screen.queryByText('Обычная')).not.toBeInTheDocument();
    expect(within(card('Нет воды')).getByText('Высокая')).toHaveClass('bg-tone-urgent-bg');
  });

  test('an empty column says so in words, without an emoji and in the readable tone', () => {
    render(<ProblemsBoard problems={problems} />);

    const empty = within(column('В работе')).getByText('Заданий пока нет');
    expect(empty).not.toHaveClass('text-muted-foreground/60');
  });
});

// The owner, 10.10: «Выполнено» will hold very many tasks in time; the page
// must not grow too tall, yet the old ones must stay within reach.
describe('the «Выполнено» column', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const MINUTE_MS = 60 * 1000;
  const at = (origin: number, offset: number) => new Date(origin + offset).toISOString();

  /**
   * `count` resolved tasks, handed over as the server reads them — newest
   * reported first — while «Лампа N» was resolved later the larger its N.
   */
  function resolvedTasks(count: number): Problem[] {
    return Array.from({ length: count }, (_, index) => {
      const n = index + 1;
      return problemSchema.parse({
        ...base,
        id: `77777777-0000-4000-8000-${String(n).padStart(12, '0')}`,
        title: `Лампа ${n}`,
        status: 'resolved',
        created_at: at(Date.UTC(2026, 8, 30), -n * HOUR_MS),
        resolved_at: at(Date.UTC(2026, 9, 1), n * MINUTE_MS),
        fix_tasks: [],
      });
    });
  }

  const shownTitles = () =>
    within(column('Выполнено'))
      .getAllByRole('article')
      .map((one) => within(one).getByRole('link').textContent);
  const lamps = (...numbers: number[]) => numbers.map((n) => `Лампа ${n}`);
  const range = (from: number, to: number) =>
    Array.from({ length: from - to + 1 }, (_, index) => from - index);

  test('shows the ten resolved last, newest first, and keeps the whole count in its head', () => {
    render(<ProblemsBoard problems={resolvedTasks(25)} />);

    expect(shownTitles()).toEqual(lamps(...range(25, 16)));
    expect(within(column('Выполнено')).getByText('25')).toBeInTheDocument();
  });

  test('«Показать ещё» says how many more and how many in all, and shows them', async () => {
    render(<ProblemsBoard problems={resolvedTasks(25)} />);

    const more = within(column('Выполнено')).getByRole('button', {
      name: 'Показать ещё 15 (всего 25)',
    });
    expect(more).toHaveClass('h-11');
    await userEvent.click(more);

    expect(shownTitles()).toEqual(lamps(...range(25, 1)));
    expect(within(column('Выполнено')).queryByRole('button', { name: /Показать ещё/ })).toBeNull();
  });

  test('each press shows twenty more, until all are there', async () => {
    render(<ProblemsBoard problems={resolvedTasks(45)} />);

    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё 20 (всего 45)' }));
    expect(shownTitles()).toHaveLength(30);

    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё 15 (всего 45)' }));
    expect(shownTitles()).toHaveLength(45);
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).toBeNull();
  });

  // From the keyboard: the button is reached and pressed like any other, and
  // the reader lands on the first card it brought rather than on nothing.
  test('works from the keyboard, and takes the focus to the first card it showed', async () => {
    render(<ProblemsBoard problems={resolvedTasks(25)} />);

    within(column('Выполнено'))
      .getByRole('button', { name: /Показать ещё/ })
      .focus();
    await userEvent.keyboard('{Enter}');

    expect(within(card('Лампа 15')).getByRole('link', { name: 'Лампа 15' })).toHaveFocus();
  });

  test('leaves the other three columns whole', () => {
    const open = Array.from({ length: 15 }, (_, index) =>
      problemSchema.parse({
        ...base,
        id: `11111111-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        title: `Кран ${index + 1}`,
        status: 'open',
        fix_tasks: [],
      }),
    );
    render(<ProblemsBoard problems={[...open, ...resolvedTasks(12)]} />);

    expect(within(column('Открыто')).getAllByRole('article')).toHaveLength(15);
    expect(within(column('Открыто')).queryByRole('button', { name: /Показать ещё/ })).toBeNull();
    expect(shownTitles()).toHaveLength(10);
  });
});

// The page's «перенос только мышью»: every move the mouse can make, the card's
// menu makes too — from the keyboard, on a touch screen.
describe('ProblemsBoard card menu', () => {
  // An «assigned» problem whose job is gone (a stale row): there is nobody to
  // take off. The menu does not offer «Открыто», and a drop there is refused
  // — neither path sends anything.
  test('offers no «Открыто» without a live job, and a drop there is refused in words', async () => {
    const orphan = problemSchema.parse({
      ...base,
      id: '99999999-9999-4999-8999-999999999999',
      title: 'Скрипит дверь',
      status: 'assigned',
      fix_tasks: [],
    });
    render(<ProblemsBoard problems={[orphan]} />);

    expect(itemsOf(await openCardMenu('Скрипит дверь'))).toEqual(['Перевести в «Выполнено»']);
    await userEvent.keyboard('{Escape}');

    dragTo('Скрипит дверь', 'Открыто');
    expect(mutations.unassign).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(DRAG_REFUSED);
  });

  test('offers the columns a card can go to, and not the technician’s own', async () => {
    render(<ProblemsBoard problems={[...problems, resolved]} />);

    expect(itemsOf(await openCardMenu('Течёт кран'))).toEqual([
      'Перевести в «Назначено»',
      'Перевести в «Выполнено»',
    ]);
    await userEvent.keyboard('{Escape}');
    expect(itemsOf(await openCardMenu('Сломан замок'))).toEqual([
      'Перевести в «Открыто»',
      'Перевести в «Выполнено»',
    ]);
    await userEvent.keyboard('{Escape}');
    expect(itemsOf(await openCardMenu('Перегорела лампа'))).toEqual(['Перевести в «Открыто»']);
  });

  // Owner, 05.10: the menu asks the same question the drop does.
  test('«Открыто» asks first, then takes off the person the card shows, as the drop does', async () => {
    render(<ProblemsBoard problems={problems} />);

    const menu = await openCardMenu('Сломан замок');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Перевести в «Открыто»' }));
    const question = await screen.findByRole('dialog', { name: 'Снять техника с работы?' });
    expect(mutations.unassign).not.toHaveBeenCalled();
    await userEvent.click(within(question).getByRole('button', { name: 'Снять' }));

    expect(mutations.unassign).toHaveBeenCalledWith(
      { taskId: TASK_ID, assigneeId: TECH_ID },
      expect.anything(),
    );
  });

  // Owner, 05.10: since f969563 the server takes the technician off the job
  // (unassign_problem) rather than cancelling it, and the line says so.
  test('says the technician is taken off once the server has done it', async () => {
    mutations.unassign.mockImplementation(
      (_variables: unknown, options: { onSuccess?: () => void }) => options.onSuccess?.(),
    );
    render(<ProblemsBoard problems={problems} />);

    const menu = await openCardMenu('Сломан замок');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Перевести в «Открыто»' }));
    const question = await screen.findByRole('dialog', { name: 'Снять техника с работы?' });
    await userEvent.click(within(question).getByRole('button', { name: 'Снять' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'Техник снят с работы, задание снова открыто',
    );
  });

  test('«Назначено» opens the technician form, «Выполнено» asks first', async () => {
    render(<ProblemsBoard problems={problems} />);

    let menu = await openCardMenu('Течёт кран');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Перевести в «Назначено»' }));
    const form = await screen.findByRole('dialog');
    expect(within(form).getByLabelText('Техник')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    menu = await openCardMenu('Течёт кран');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Перевести в «Выполнено»' }));
    const question = await screen.findByRole('dialog', { name: 'Отметить выполненным?' });
    expect(mutations.resolve).not.toHaveBeenCalled();
    await userEvent.click(within(question).getByRole('button', { name: 'Да, выполнено' }));
    expect(mutations.resolve).toHaveBeenCalledWith(OPEN_ID, expect.anything());
  }, 20000);

  test('a resolved card goes back to «Открыто» through its menu', async () => {
    render(<ProblemsBoard problems={[resolved]} />);

    const menu = await openCardMenu('Перегорела лампа');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Перевести в «Открыто»' }));

    expect(mutations.reopen).toHaveBeenCalledWith(RESOLVED_ID, expect.anything());
  });

  test('the menu is a 44 px target that leaves the card a link to its page', () => {
    render(<ProblemsBoard problems={problems} />);

    const button = within(card('Течёт кран')).getByRole('button', { name: 'Действия: Течёт кран' });
    expect(button).toHaveClass('size-11');
    expect(button.closest('a')).toBeNull();
  });
});

// The review of 05.10 (1175e15..c772831).
describe('ProblemsBoard after the review', () => {
  // p_expected_assignee: the card showed Petr; if the job went to somebody
  // else meanwhile, the server refuses rather than take the wrong person off.
  test('a take-off the server refuses closes the question and says so in words', async () => {
    mutations.unassign.mockImplementation(
      (_variables: unknown, options: { onSettled?: () => void }) => {
        outcome.unassign = {
          isPending: false,
          isError: true,
          error: { hint: 'serverErrors.taskChangedMeanwhile' },
        };
        options.onSettled?.();
      },
    );
    render(<ProblemsBoard problems={problems} />);

    dragTo('Сломан замок', 'Открыто');
    const question = await screen.findByRole('dialog', { name: 'Снять техника с работы?' });
    await userEvent.click(within(question).getByRole('button', { name: 'Снять' }));

    expect(mutations.unassign).toHaveBeenCalledWith(
      { taskId: TASK_ID, assigneeId: TECH_ID },
      expect.anything(),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Это уже изменилось — экран обновлён');
  });

  test.each(['Escape', 'the overlay'])(
    '%s closes the take-off question without a word to the server',
    async (way) => {
      render(<ProblemsBoard problems={problems} />);

      dragTo('Сломан замок', 'Открыто');
      await screen.findByRole('dialog', { name: 'Снять техника с работы?' });
      if (way === 'Escape') {
        await userEvent.keyboard('{Escape}');
      } else {
        // A click on the backdrop, as Base UI's outside press reads it (a
        // press-less click: user-event's pointer sequence trips over jsdom).
        fireEvent.click(document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement);
      }

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mutations.unassign).not.toHaveBeenCalled();
      expect(
        within(column('Назначено')).getByRole('article', { name: 'Сломан замок' }),
      ).toBeVisible();
    },
  );

  test('a second press while the first is on its way sends nothing more', async () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Сломан замок', 'Открыто');
    const question = await screen.findByRole('dialog', { name: 'Снять техника с работы?' });
    const confirm = within(question).getByRole('button', { name: 'Снять' });
    await userEvent.click(confirm);
    await userEvent.click(confirm);

    expect(mutations.unassign).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
  });

  test('the answer to an earlier question does not close the next one', async () => {
    let settleResolve: (() => void) | undefined;
    mutations.resolve.mockImplementation((_id: string, options: { onSettled?: () => void }) => {
      settleResolve = options.onSettled;
    });
    render(<ProblemsBoard problems={problems} />);

    let menu = await openCardMenu('Течёт кран');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Перевести в «Выполнено»' }));
    const resolveQuestion = await screen.findByRole('dialog', { name: 'Отметить выполненным?' });
    await userEvent.click(within(resolveQuestion).getByRole('button', { name: 'Да, выполнено' }));
    await userEvent.keyboard('{Escape}');

    menu = await openCardMenu('Сломан замок');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Перевести в «Открыто»' }));
    await screen.findByRole('dialog', { name: 'Снять техника с работы?' });
    act(() => settleResolve?.());

    expect(screen.getByRole('dialog', { name: 'Снять техника с работы?' })).toBeInTheDocument();
  }, 20000);

  // A card moved to another column by a refresh while it was dragged is a new
  // element: its dragend never reaches the board.
  test.each([
    ['a dragend', () => fireEvent.dragEnd(window)],
    ['a drop anywhere', () => fireEvent.drop(document.body)],
  ])('%s heard by the window ends the drag, so no column stays lit', (_how, end) => {
    render(<ProblemsBoard problems={problems} />);

    fireEvent.dragStart(card('Течёт кран'));
    expect(column('Назначено')).toHaveAttribute('data-droppable', 'true');
    end();

    expect(column('Назначено')).not.toHaveAttribute('data-droppable');
  });

  // A live region speaks when its text changes: the same refusal twice is
  // said twice only if the line is written afresh.
  test('a refusal said twice is written afresh, so a screen reader says it again', () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Течёт кран', 'Выполнено');
    const first = within(screen.getByRole('status')).getByText(DRAG_REFUSED);
    dragTo('Течёт кран', 'Выполнено');
    const second = within(screen.getByRole('status')).getByText(DRAG_REFUSED);

    expect(second).not.toBe(first);
  });

  // While the question closes it fades out: its words must not vanish first.
  test('the take-off question keeps its words while it closes', async () => {
    const { result } = renderHook(() => useBoardMoves());

    act(() => result.current.moveTo(problems[1], 'open'));
    expect(result.current.pending?.kind).toBe('unassign');
    act(() => result.current.closePending());

    expect(result.current.pending).toBeNull();
    expect(result.current.shown?.problem.title).toBe('Сломан замок');
  });
});
