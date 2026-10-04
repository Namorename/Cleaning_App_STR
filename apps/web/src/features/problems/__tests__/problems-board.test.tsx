import { fireEvent, render, screen, within } from '@testing-library/react';
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

vi.mock('../use-problems', () => ({
  useResolveProblem: () => ({ ...idle, mutate: mutations.resolve, reset: resets.resolve }),
  useUnassignProblem: () => ({ ...idle, mutate: mutations.unassign, reset: resets.unassign }),
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

  test('dropping an assigned card on "open" takes off the person the card shows', () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Сломан замок', 'Открыто');

    expect(mutations.unassign).toHaveBeenCalledWith(
      { taskId: TASK_ID, assigneeId: TECH_ID },
      expect.anything(),
    );
  });

  // A stale screen now makes "take the technician off" fail routinely
  // (serverErrors.taskChangedMeanwhile). The status line shows the first
  // failed mutation, so an old refusal must not outlive the next action.
  test('every drop clears the outcome an earlier action left', () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Течёт кран', 'Открыто');

    expect(resets.resolve).toHaveBeenCalled();
    expect(resets.unassign).toHaveBeenCalled();
    expect(resets.reopen).toHaveBeenCalled();
  });

  test('dropping on "resolved" asks first and resolves on confirmation', async () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Течёт кран', 'Выполнено');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/«Течёт кран» закроется как выполненное/)).toBeInTheDocument();
    expect(mutations.resolve).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, выполнено' }));
    expect(mutations.resolve).toHaveBeenCalledWith(OPEN_ID, expect.anything());
  });

  test('the resolve dialog closes once the server has answered, refusal included', async () => {
    mutations.resolve.mockImplementation((_id: string, options: { onSettled?: () => void }) =>
      options.onSettled?.(),
    );
    render(<ProblemsBoard problems={problems} />);

    dragTo('Течёт кран', 'Выполнено');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, выполнено' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('dropping an open card on "assigned" opens the technician form', async () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Течёт кран', 'Назначено');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Назначить техника')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Техник')).toBeInTheDocument();
  });

  test('"in progress" explains that the technician starts the task', () => {
    render(<ProblemsBoard problems={problems} />);

    dragTo('Течёт кран', 'В работе');

    expect(screen.getByRole('status')).toHaveTextContent(
      'В работу задание переводит техник кнопкой «Начать работу» в приложении',
    );
    expect(mutations.resolve).not.toHaveBeenCalled();
    expect(mutations.unassign).not.toHaveBeenCalled();
  });

  test('a resolved card dragged back to "open" is reopened, anywhere else it stays', () => {
    render(<ProblemsBoard problems={[...problems, resolved]} />);
    expect(card('Перегорела лампа')).toHaveAttribute('draggable', 'true');

    dragTo('Перегорела лампа', 'Назначено');
    expect(mutations.reopen).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Отсюда перенести сюда нельзя');

    dragTo('Перегорела лампа', 'Открыто');
    expect(mutations.reopen).toHaveBeenCalledWith(RESOLVED_ID, expect.anything());
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

// The page's «перенос только мышью»: every move the mouse can make, the card's
// menu makes too — from the keyboard, on a touch screen.
describe('ProblemsBoard card menu', () => {
  // An «assigned» problem whose job is gone (a stale row): there is nobody to
  // take off. The menu does not offer «Открыто», and a drop there says it
  // cannot be done — neither path sends anything.
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
    expect(screen.getByRole('status')).toHaveTextContent('Отсюда перенести сюда нельзя');
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

  test('«Открыто» takes off the person the card shows, as the drop does', async () => {
    render(<ProblemsBoard problems={problems} />);

    const menu = await openCardMenu('Сломан замок');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Перевести в «Открыто»' }));

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
    const question = screen.queryByRole('dialog');
    if (question !== null) {
      await userEvent.click(within(question).getByRole('button', { name: 'Снять' }));
    }

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
