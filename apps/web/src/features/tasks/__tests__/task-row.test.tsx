import { ICONS } from '@str-ops/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { taskSchema, type Task } from '../schema';
import { TaskRow } from '../task-row';

// 10:00 UTC on 23.09: the same calendar day in the fixtures' zone whatever
// the machine's clock says, so no run can straddle midnight.
const NOW = new Date('2026-09-23T10:00:00Z');

const base = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  property_id: 1,
  reservation_id: 63925530,
  problem_id: null,
  type: 'cleaning',
  status: 'unassigned',
  priority: 0,
  assignee_id: null,
  created_by: null,
  scheduled_date: '2026-09-23',
  time_from: null,
  time_to: null,
  started_at: null,
  completed_at: null,
  measured_minutes: null,
  duration_override_min: null,
  is_parallel: false,
  is_short_measurement: null,
  notes: null,
  title: null,
  title_i18n: null,
  created_at: '2026-09-10T08:00:00+00:00',
  property: { name: 'Vinohrady 12', timezone: 'Europe/Prague' },
  assignee: null,
  author: null,
};

const task = (overrides: Partial<Record<keyof typeof base, unknown>>): Task =>
  taskSchema.parse({ ...base, ...overrides });

const handlers = { onOpenWork: vi.fn(), onOpenChat: vi.fn() };

function renderRow(one: Task, hasUnread = false) {
  render(
    <table>
      <tbody>
        <TaskRow
          task={one}
          now={NOW}
          onEdit={vi.fn()}
          onOpenWork={handlers.onOpenWork}
          onOpenChat={handlers.onOpenChat}
          onCancel={vi.fn()}
          hasUnread={hasUnread}
        />
      </tbody>
    </table>,
  );
  return screen.getByRole('row');
}

/** What the row's «⋯» offers, in order. */
async function menuItems(): Promise<string[]> {
  await userEvent.click(screen.getByRole('button', { name: /^Действия: / }));
  const menu = await screen.findByRole('menu');
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a live cleaning left over from yesterday', () => {
  test('says since when and which check-out it belongs to, in words', () => {
    renderRow(task({ scheduled_date: '2026-09-22' }));

    expect(screen.getByText('со вчера · выезд 22.09')).toBeInTheDocument();
  });

  // The stripe is the overdue tone's (STATUS_TONE['tasks.tail']): red is
  // «Просрочено» and «Срочно» only, in their own shades.
  test('is striped in the overdue tone, so it stands out among the day', () => {
    const row = renderRow(task({ scheduled_date: '2026-09-22' }));

    expect(row).toHaveAttribute('data-tail');
    expect(within(row).getAllByRole('cell')[0]).toHaveClass('border-tone-overdue-mark');
  });
});

describe('a task that is not a tail', () => {
  test("today's cleaning carries neither the label nor the stripe", () => {
    const row = renderRow(task({}));

    expect(screen.queryByText(/со вчера/)).not.toBeInTheDocument();
    expect(row).not.toHaveAttribute('data-tail');
    expect(within(row).getAllByRole('cell')[0]).not.toHaveClass('border-tone-overdue-mark');
  });

  test('a finished one from yesterday is history, not a tail', () => {
    renderRow(task({ scheduled_date: '2026-09-22', status: 'done' }));

    expect(screen.queryByText(/со вчера/)).not.toBeInTheDocument();
  });
});

describe('an older tail', () => {
  test('a repair days behind is called overdue, with its planned day', () => {
    renderRow(
      task({
        scheduled_date: '2026-09-19',
        status: 'assigned',
        type: 'maintenance',
        reservation_id: null,
        problem_id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
        assignee_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
      }),
    );

    expect(screen.getByText('Просрочена · 19.09')).toBeInTheDocument();
    expect(screen.getByText('Из задания')).toBeInTheDocument();
  });

  test('an older booking cleaning names its check-out', () => {
    renderRow(
      task({
        scheduled_date: '2026-09-21',
        status: 'assigned',
        assignee_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
      }),
    );

    expect(screen.getByText('Просрочена · выезд 21.09')).toBeInTheDocument();
  });
});

describe('the rest of a row', () => {
  test('a job without a window says so to a reader, a dash to the eye', () => {
    const row = renderRow(task({}));

    const when = within(row).getAllByRole('cell')[0];
    expect(within(when).getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(within(when).getByText('Без времени')).toHaveClass('sr-only');
  });

  // Owner, 04.10: the note is a small mark by the name; its text on hover and
  // on keyboard focus, whole in the form.
  test('a note is a mark by the name that a reader hears whole', () => {
    const row = renderRow(task({ title: 'Мойка окон', notes: 'Ключ у соседа, кв. 4' }));

    const name = within(row).getAllByRole('cell')[3];
    expect(name).toHaveTextContent('Мойка окон');
    const mark = within(name).getByRole('button', {
      name: 'Заметка для исполнителя: Ключ у соседа, кв. 4',
    });
    expect(mark.querySelector('svg')).toHaveClass(`lucide-${ICONS['meta.note']}`);
    expect(mark.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // Not a text in the row: the row stays one line.
    expect(screen.queryByText('Ключ у соседа, кв. 4')).not.toBeInTheDocument();
  });

  test("the note's text shows when the mark takes the keyboard's focus", async () => {
    renderRow(task({ title: 'Мойка окон', notes: 'Ключ у соседа, кв. 4' }));

    await userEvent.tab();
    expect(screen.getByRole('button', { name: /^Заметка для исполнителя/ })).toHaveFocus();

    expect(await screen.findByText('Ключ у соседа, кв. 4')).toBeVisible();
  });

  // A phone has no hover and a tap is no keyboard focus: the press itself
  // shows the text (the review of 04.10). A bare click — no hover, no focus.
  test("a press on the mark shows the note's text", async () => {
    renderRow(task({ title: 'Мойка окон', notes: 'Ключ у соседа, кв. 4' }));

    fireEvent.click(screen.getByRole('button', { name: /^Заметка для исполнителя/ }));

    expect(await screen.findByText('Ключ у соседа, кв. 4')).toBeVisible();
  });

  test('the note mark is a 44 px target', () => {
    renderRow(task({ notes: 'Ключ у соседа' }));

    expect(screen.getByRole('button', { name: /^Заметка для исполнителя/ })).toHaveClass('size-11');
  });

  test('no note, no mark', () => {
    renderRow(task({ title: 'Мойка окон' }));

    expect(screen.queryByRole('button', { name: /Заметка/ })).not.toBeInTheDocument();
  });

  test('names who asked for a job the manager wrote, beside nothing else', () => {
    renderRow(
      task({
        reservation_id: null,
        author: { full_name: 'Eva Novak', role: 'manager' },
      }),
    );

    expect(screen.getByText('Поставил:')).toBeInTheDocument();
    expect(screen.getByTitle('Менеджер')).toHaveTextContent('Eva Novak');
    expect(screen.queryByText('Из брони')).not.toBeInTheDocument();
  });
});

// 5.4, «Чат», variant B: the conversation has a sheet of its own, so the menu
// names it on every row; the drawer is the work's, offered once there is work.
describe('the menu of a row', () => {
  test('a job nobody has started offers its conversation, and no work', async () => {
    renderRow(task({}));

    expect(await menuItems()).toEqual(['Изменить', 'Разговор']);
  });

  test('a job under way offers how it is going, then the conversation', async () => {
    renderRow(
      task({
        status: 'in_progress',
        assignee_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
        started_at: '2026-09-23T09:00:00+00:00',
      }),
    );

    expect(await menuItems()).toEqual(['Изменить', 'Как идёт уборка', 'Разговор']);
  });

  test('a technician’s job under way is named a job', async () => {
    renderRow(
      task({
        type: 'maintenance',
        status: 'in_progress',
        reservation_id: null,
        problem_id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
        assignee_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
        started_at: '2026-09-23T09:00:00+00:00',
      }),
    );

    expect(await menuItems()).toEqual(['Изменить', 'Как идёт работа', 'Разговор']);
  });

  test('a finished job offers how it went and the conversation, and opens each', async () => {
    const done = task({
      status: 'done',
      started_at: '2026-09-23T08:00:00+00:00',
      completed_at: '2026-09-23T09:30:00+00:00',
    });
    renderRow(done);

    expect(await menuItems()).toEqual(['Как прошла уборка', 'Разговор']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Разговор' }));
    expect(handlers.onOpenChat).toHaveBeenCalledWith(done);

    await menuItems();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Как прошла уборка' }));
    expect(handlers.onOpenWork).toHaveBeenCalledWith(done);
  }, 20000);
});

describe('the mark of an unread message', () => {
  test('is a button of 44 px that opens the conversation of the row', async () => {
    const one = task({});
    renderRow(one, true);

    const mark = screen.getByRole('button', { name: /^Новое сообщение — открыть разговор: / });
    expect(mark).toHaveTextContent('Новое сообщение');
    expect(mark).toHaveClass('min-h-11');
    await userEvent.click(mark);

    expect(handlers.onOpenChat).toHaveBeenCalledWith(one);
  });
});
