import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';

import { todayIso } from '@/lib/format-date';

import { taskSchema, type Task } from '../schema';

const MARIA = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = todayIso();
const TOMORROW = todayIso(new Date(Date.now() + DAY_MS));

const base = {
  property_id: 1,
  reservation_id: null,
  problem_id: null,
  type: 'cleaning',
  status: 'assigned',
  priority: 0,
  assignee_id: null,
  created_by: null,
  scheduled_date: TODAY,
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
  property: { name: 'Vinohrady 12' },
  assignee: null,
  author: null,
};

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`;
const task = (overrides: Partial<Task> & { id: string }): Task =>
  taskSchema.parse({ ...base, ...overrides });

const morning = task({
  id: id(1),
  title: 'Генеральная уборка',
  time_from: '09:00:00',
  time_to: '11:00:00',
  assignee_id: MARIA,
  assignee: { full_name: 'Maria Test', role: 'cleaner' },
});
const evening = task({
  id: id(2),
  type: 'inspection',
  title: 'Вечерний осмотр',
  time_from: '18:00:00',
  status: 'unassigned',
});
const upcoming = task({
  id: id(3),
  title: 'Уборка завтра',
  scheduled_date: TOMORROW,
  reservation_id: 77,
});
const finished = task({
  id: id(4),
  title: 'Вчерашняя уборка',
  status: 'done',
  started_at: '2026-09-10T08:00:00+00:00',
  completed_at: '2026-09-10T09:35:00+00:00',
  measured_minutes: 95,
  assignee: { full_name: 'Maria Test', role: 'cleaner' },
});

const staff = [{ id: MARIA, full_name: 'Maria Test', role: 'cleaner' }];
const properties = [{ id: 1, name: 'Vinohrady 12' }];

const useTasks = vi.fn();
const saveTask = vi.fn();
const cancelTask = vi.fn();
const setDuration = vi.fn();
const saveState = { isPending: false, isError: false, error: null as unknown };
const cancelState = {
  isPending: false,
  isError: false,
  error: null as unknown,
  variables: undefined as unknown,
};
const idle = { isPending: false, isError: false, error: null, reset: vi.fn() };

vi.mock('../use-tasks', () => ({
  useTasks: () => useTasks(),
  useStaff: () => ({ data: staff, isPending: false, isError: false }),
  useProperties: () => ({ data: properties, isPending: false, isError: false }),
  useTaskWork: () => ({
    data: {
      steps: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
          sort_order: 1,
          type: 'photos_after',
          required: true,
          title: 'Фото после уборки',
          title_i18n: null,
          completed_at: '2026-09-10T09:30:00+00:00',
          skipped_at: null,
          waived_at: null,
        },
      ],
      mediaByStep: {},
    },
    isPending: false,
    isError: false,
  }),
  useTaskProblems: () => ({ data: [], isPending: false, isError: false }),
  useReservationGuest: () => ({ data: undefined, isPending: true, isError: false }),
  useSaveTask: () => ({ ...saveState, mutate: saveTask, reset: idle.reset }),
  useCancelTask: () => ({ ...cancelState, mutate: cancelTask, reset: idle.reset }),
  useSetDuration: () => ({ ...idle, mutate: setDuration }),
}));

// The conversation has its own tests; here it only has to open about the
// right job, one sheet at a time.
vi.mock('@/features/chat/chat-sheet', () => ({
  ChatSheet: (props: {
    subject: Record<string, string>;
    about: string;
    returnFocus?: () => HTMLElement | null;
  }) => (
    <div role="dialog" aria-label="Чат">
      {`${Object.values(props.subject).join(',')} · ${props.about}`}
      {/* Where the real sheet sends the focus when it closes. */}
      <button type="button" onClick={() => props.returnFocus?.()?.focus()}>
        Вернуть фокус
      </button>
    </div>
  ),
}));

// The router reads the address jsdom holds; the view writes it through
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

// The marks come from one company-wide answer; here it is a pair of sets the
// test fills by hand.
const unread = { tasks: new Set<string>(), problems: new Set<string>() };
vi.mock('@/features/chat/use-chat', () => ({ useUnreadSubjects: () => unread }));

import { expectPageTitle } from '@/components/page-header.expect';

import { TasksView } from '../tasks-view';

/** The query of the page's address, without its `?`. */
const query = () => window.location.search.slice(1);

/** «Назад»: jsdom walks the history a task later and says so with `popstate`. */
function goBack(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.back();
  });
}

/** The table row a text stands in. */
const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

/** Opens a row's «⋯» and hands back the menu. */
async function openMenu(row: HTMLElement): Promise<HTMLElement> {
  await userEvent.click(within(row).getByRole('button', { name: /^Действия: / }));
  return screen.findByRole('menu');
}

/** What a row's «⋯» offers, in order. */
async function menuItems(row: HTMLElement): Promise<string[]> {
  const menu = await openMenu(row);
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/tasks');
  unread.tasks.clear();
  saveState.isError = false;
  saveState.error = null;
  cancelState.isError = false;
  cancelState.error = null;
  useTasks.mockReturnValue({
    data: [morning, evening, upcoming, finished],
    isPending: false,
    isError: false,
  });
});

describe('TasksView', () => {
  test('is headed by the common header', () => {
    render(<TasksView />);

    expectPageTitle('Уборки');
  });

  test('opens on today, grouped by the part of the day, and counts every tab', () => {
    render(<TasksView />);

    expect(screen.getByRole('tab', { name: /Сегодня/ })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Ближайшие/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Завершённые/ })).toHaveTextContent('1');

    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Утро', 'Вечер']);
    expect(screen.getByText('Генеральная уборка')).toBeInTheDocument();
    expect(screen.getByText('09:00 – 11:00')).toBeInTheDocument();
    expect(screen.queryByText('Уборка завтра')).not.toBeInTheDocument();
  });

  // Variant A (docs/design/decisions.md §2): one line a job, the actions in «⋯».
  test('is one table: a job a row, in the columns of variant A, with one menu each', () => {
    render(<TasksView />);

    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Время',
      'Объект',
      'Тип',
      'Название',
      'Статус',
      'Исполнитель',
      'Метки',
      'Действия',
    ]);

    const row = rowOf('Генеральная уборка');
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      '09:00 – 11:00',
      'Vinohrady 12',
      'Уборка',
      'Генеральная уборка',
      'Назначена',
      'Горничная: Maria Test',
      '',
      '',
    ]);
    // The row's one target, 44 px square (TOUCH_TARGET.panelMin).
    expect(
      within(row).getByRole('button', { name: 'Действия: Генеральная уборка · Vinohrady 12' }),
    ).toHaveClass('size-11');
    expect(within(row).getAllByRole('button')).toHaveLength(1);
  });

  // «Без исполнителя» stood twice in one card, the kind twice in an unnamed one.
  test('says «nobody» and the kind once a row', () => {
    useTasks.mockReturnValue({
      data: [task({ id: id(5), title: null, time_from: '09:00:00', status: 'unassigned' })],
      isPending: false,
      isError: false,
    });
    render(<TasksView />);

    const cells = within(rowOf('Vinohrady 12')).getAllByRole('cell');
    expect(cells[2]).toHaveTextContent('Уборка');
    expect(cells[3].textContent).toBe('');
    expect(cells[4]).toHaveTextContent('Без исполнителя');
    // The executor's column is a dash on screen; the words are for a reader.
    expect(within(cells[5]).getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(within(cells[5]).getByText('Без исполнителя')).toHaveClass('sr-only');
  });

  test("puts what is left over from earlier days above today's work, under its own heading", () => {
    // The clock stands at noon of TODAY, so "yesterday" here and "today" in
    // the view cannot fall on two sides of a midnight.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
    onTestFinished(() => {
      vi.useRealTimers();
    });

    // Arrange: yesterday's live cleaning in the evening, among today's two.
    const YESTERDAY = todayIso(new Date(Date.now() - DAY_MS));
    const leftOver = task({
      id: id(5),
      title: 'Уборка со вчера',
      scheduled_date: YESTERDAY,
      time_from: '18:00:00',
      status: 'unassigned',
    });
    useTasks.mockReturnValue({
      data: [morning, evening, leftOver],
      isPending: false,
      isError: false,
    });

    // Act
    render(<TasksView />);

    // Assert: the tail heads the tab rather than hiding in the evening.
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'С прошлых дней',
      'Утро',
      'Вечер',
    ]);
    const titles = ['Уборка со вчера', 'Генеральная уборка', 'Вечерний осмотр'].map((title) =>
      screen.getByText(title),
    );
    expect(
      titles.every((node, index) =>
        index === 0
          ? true
          : Boolean(
              titles[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
            ),
      ),
    ).toBe(true);
    // Labelled in words, not by its stripe alone.
    expect(rowOf('Уборка со вчера')).toHaveTextContent('со вчера');
  });

  test('a cleaning of a room is labelled by its house, and found by it', async () => {
    // Arrange: the shape nine listings produce since the cleanings moved onto
    // rooms — the row is called "1 - 2109" and names no building at all.
    const inRoom = task({
      id: id(9),
      title: 'Уборка комнаты',
      time_from: '09:30:00',
      property: {
        name: '1 - 2109',
        hostaway_unit_id: 18007,
        parent: { name: 'CZ - Vinohradska Royal' },
      },
    });
    useTasks.mockReturnValue({ data: [inRoom], isPending: false, isError: false });
    render(<TasksView />);

    // Assert: the row says both, and the search for the house finds it.
    expect(rowOf('Уборка комнаты')).toHaveTextContent('CZ - Vinohradska Royal — 1 - 2109');

    await userEvent.type(
      screen.getByLabelText('Поиск по названию, объекту, исполнителю'),
      'vinohradska',
    );
    expect(screen.getByText('Уборка комнаты')).toBeInTheDocument();
  }, 20000);

  test('switches to the days ahead and marks where a task came from', async () => {
    render(<TasksView />);

    await userEvent.click(screen.getByRole('tab', { name: /Ближайшие/ }));
    const row = rowOf('Уборка завтра');
    expect(row).toHaveTextContent('Из брони');
    // A task from a booking is not the manager's to call off.
    expect(await menuItems(row)).toEqual(['Изменить', 'Чат']);
  });

  test('a job the manager wrote is the one the menu offers to call off', async () => {
    render(<TasksView />);

    expect(await menuItems(rowOf('Вечерний осмотр'))).toEqual([
      'Изменить',
      'Чат',
      'Отменить уборку',
    ]);
  });

  test('filters by person and by kind', async () => {
    render(<TasksView />);

    await userEvent.selectOptions(screen.getByLabelText('Исполнитель'), 'Без исполнителя');
    expect(screen.queryByText('Генеральная уборка')).not.toBeInTheDocument();
    expect(screen.getByText('Вечерний осмотр')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Исполнитель'), 'Любой исполнитель');
    await userEvent.selectOptions(screen.getByLabelText('Тип'), 'Осмотр');
    expect(screen.queryByText('Генеральная уборка')).not.toBeInTheDocument();
    expect(screen.getByText('Вечерний осмотр')).toBeInTheDocument();
  });

  test('narrows the schedule to a day, and says who is on the job', async () => {
    render(<TasksView />);

    // The executor is named, with the icon of what she does beside her.
    expect(within(rowOf('Генеральная уборка')).getByTitle('Горничная')).toHaveTextContent(
      'Maria Test',
    );

    await userEvent.click(screen.getByRole('tab', { name: /Ближайшие/ }));
    expect(screen.getByText('Уборка завтра')).toBeInTheDocument();

    // Both ends of the range are named on screen, not only for a reader.
    expect(screen.getByText('Дата с').tagName).toBe('LABEL');
    expect(screen.getByText('Дата по').tagName).toBe('LABEL');
    await userEvent.type(screen.getByLabelText('Дата с'), TODAY);
    await userEvent.type(screen.getByLabelText('Дата по'), TODAY);
    expect(screen.queryByText('Уборка завтра')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Ближайшие/ })).toHaveTextContent('0');

    await userEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(screen.getByText('Уборка завтра')).toBeInTheDocument();
  }, 20000);

  test('every control of the filter bar is a 44 px target', () => {
    render(<TasksView />);

    for (const label of ['Исполнитель', 'Тип', 'Дата с', 'Дата по', /Поиск/]) {
      expect(screen.getByLabelText(label)).toHaveClass('h-11');
    }
    expect(screen.getByRole('button', { name: 'Новая уборка' })).toHaveClass('h-11');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('min-h-11');
    }
  });

  test('says nothing was found rather than that there is no work', async () => {
    render(<TasksView />);

    await userEvent.type(screen.getByLabelText(/Поиск/), 'ничего такого');
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('writes a new task through the form', async () => {
    render(<TasksView />);

    await userEvent.click(screen.getByRole('button', { name: 'Новая уборка' }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.selectOptions(within(dialog).getByLabelText('Объект'), 'Vinohrady 12');
    await userEvent.type(within(dialog).getByLabelText(/Название/), 'Мойка окон');
    await userEvent.selectOptions(within(dialog).getByLabelText('Исполнитель'), 'Maria Test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    expect(saveTask).toHaveBeenCalledWith(
      {
        draft: expect.objectContaining({
          propertyId: 1,
          type: 'cleaning',
          title: 'Мойка окон',
          assigneeId: MARIA,
        }),
      },
      expect.anything(),
    );
  }, 20000);

  test('saves a task with no name at all', async () => {
    render(<TasksView />);

    await userEvent.click(screen.getByRole('button', { name: 'Новая уборка' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Объект'), 'Vinohrady 12');

    const save = within(dialog).getByRole('button', { name: 'Сохранить' });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(saveTask).toHaveBeenCalledWith(
      { draft: expect.objectContaining({ title: '' }) },
      expect.anything(),
    );
  }, 20000);

  test('offers to put a duplicate there anyway, and only after the refusal', async () => {
    saveState.isError = true;
    saveState.error = { hint: 'serverErrors.taskDuplicate', details: '{"date":"2026-09-11"}' };
    render(<TasksView />);

    await userEvent.click(screen.getByRole('button', { name: 'Новая уборка' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Объект'), 'Vinohrady 12');
    await userEvent.type(within(dialog).getByLabelText(/Название/), 'Мойка окон');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Всё равно создать' }));
    expect(saveTask).toHaveBeenCalledWith(
      { draft: expect.anything(), allowDuplicate: true },
      expect.anything(),
    );
  }, 20000);

  // An edit creates nothing: moving a task onto a taken day asks to save it anyway.
  test('on an edit, the duplicate question offers to save, not to create', async () => {
    saveState.isError = true;
    saveState.error = { hint: 'serverErrors.taskDuplicate', details: '{"date":"2026-09-11"}' };
    render(<TasksView />);

    const menu = await openMenu(rowOf('Генеральная уборка'));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByRole('button', { name: 'Всё равно создать' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Всё равно сохранить' }));
    expect(saveTask).toHaveBeenCalledWith(
      { draft: expect.anything(), allowDuplicate: true },
      expect.anything(),
    );
  }, 20000);

  test('calls a task off only after the question, which names the job, is answered', async () => {
    render(<TasksView />);

    const menu = await openMenu(rowOf('Вечерний осмотр'));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Отменить уборку' }));
    const question = await screen.findByRole('dialog', {
      name: 'Отменить уборку? Она останется в истории.',
    });
    expect(question).toHaveTextContent('Вечерний осмотр · Vinohrady 12');
    expect(cancelTask).not.toHaveBeenCalled();

    await userEvent.click(within(question).getByRole('button', { name: 'Да, отменить' }));
    expect(cancelTask).toHaveBeenCalledWith(id(2));
  }, 20000);

  test('«Нет» leaves the job as it was', async () => {
    render(<TasksView />);

    const menu = await openMenu(rowOf('Вечерний осмотр'));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Отменить уборку' }));
    const question = await screen.findByRole('dialog');
    await userEvent.click(within(question).getByRole('button', { name: 'Нет' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cancelTask).not.toHaveBeenCalled();
  }, 20000);

  // The refresh that follows a refused cancel moves the job to the closed tab
  // before the refusal arrives, so the row that asked is gone by then: the
  // sentence has to live in the view, or the refusal reads as a cancel that
  // worked.
  test('tells a refused cancel above the list, after the row has moved away', () => {
    cancelState.isError = true;
    cancelState.error = { hint: 'serverErrors.taskChangedMeanwhile' };
    useTasks.mockReturnValue({
      // Nothing is left on Today, so no row is there to carry the sentence.
      data: [{ ...evening, status: 'done' }, upcoming, finished],
      isPending: false,
      isError: false,
    });
    render(<TasksView />);

    expect(screen.queryByText('Вечерний осмотр')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Это уже изменилось — экран обновлён');
  });

  // 5.4, «Чат», variant B: the conversation slides in on its own, not inside
  // the drawer of the work.
  test('opens the conversation of a job nobody has started in a sheet of its own', async () => {
    render(<TasksView />);

    const menu = await openMenu(rowOf('Вечерний осмотр'));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Чат' }));

    const sheet = await screen.findByRole('dialog', { name: 'Чат' });
    expect(sheet).toHaveTextContent(`${id(2)} · Вечерний осмотр · Vinohrady 12`);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  }, 20000);

  // The review of 05.10: the menu or the drawer that opened the conversation is
  // gone when it closes; the focus goes back to the row's «⋯», not to the body.
  test('the conversation hands the focus back to its row’s «⋯»', async () => {
    render(<TasksView />);

    const menu = await openMenu(rowOf('Вечерний осмотр'));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Чат' }));
    const sheet = await screen.findByRole('dialog', { name: 'Чат' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Вернуть фокус' }));

    expect(
      within(rowOf('Вечерний осмотр')).getByRole('button', { name: /^Действия: / }),
    ).toHaveFocus();
  }, 20000);

  test('reads a finished cleaning and corrects the time without touching the measurement', async () => {
    render(<TasksView />);

    await userEvent.click(screen.getByRole('tab', { name: /Завершённые/ }));
    // A closed job is not edited any more: its menu reads it and its conversation.
    expect(await menuItems(rowOf('Вчерашняя уборка'))).toEqual(['Как прошла уборка', 'Чат']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Как прошла уборка' }));

    const drawer = await screen.findByRole('dialog', { name: 'Как прошла уборка' });
    expect(within(drawer).queryByLabelText('Написать…')).not.toBeInTheDocument();
    expect(drawer).toHaveTextContent('Замер: 1 ч 35 мин');
    expect(drawer).toHaveTextContent('Фото после уборки');

    await userEvent.type(within(drawer).getByLabelText('Корректировка, минут'), '80');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Сохранить' }));
    expect(setDuration).toHaveBeenCalledWith({ taskId: id(4), minutes: 80 });
  }, 20000);

  test('the drawer’s «Чат» puts the drawer away and opens the job’s conversation', async () => {
    render(<TasksView />);

    await userEvent.click(screen.getByRole('tab', { name: /Завершённые/ }));
    await userEvent.click(
      within(await openMenu(rowOf('Вчерашняя уборка'))).getByRole('menuitem', {
        name: 'Как прошла уборка',
      }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'Как прошла уборка' });
    const toChat = within(drawer).getByRole('button', { name: 'Чат' });
    expect(toChat).toHaveClass('h-11');
    await userEvent.click(toChat);

    // One sheet at a time, never one over the other.
    const sheet = await screen.findByRole('dialog', { name: 'Чат' });
    expect(sheet).toHaveTextContent(id(4));
    expect(screen.queryByRole('dialog', { name: 'Как прошла уборка' })).not.toBeInTheDocument();
  }, 20000);

  // The vocabulary (CLAUDE.md): a technician's job is «работа», not «уборка».
  test("names a technician's job a job, in its menu and on its drawer", async () => {
    const repair = (n: number, status: Task['status'], title: string) =>
      task({
        id: id(n),
        type: 'maintenance',
        status,
        title,
        problem_id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
        assignee_id: MARIA,
        assignee: { full_name: 'Petr Test', role: 'tech' },
      });
    useTasks.mockReturnValue({
      data: [
        { ...repair(6, 'in_progress', 'Течёт кран'), started_at: '2026-09-10T08:00:00+00:00' },
        { ...repair(7, 'done', 'Заменить лампу'), started_at: '2026-09-10T08:00:00+00:00' },
      ],
      isPending: false,
      isError: false,
    });
    render(<TasksView />);

    await userEvent.click(
      within(await openMenu(rowOf('Течёт кран'))).getByRole('menuitem', {
        name: 'Как идёт работа',
      }),
    );
    const open = await screen.findByRole('dialog', { name: 'Работа' });
    expect(open).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('tab', { name: /Завершённые/ }));
    expect(await menuItems(rowOf('Заменить лампу'))).toEqual(['Как прошла работа', 'Чат']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Как прошла работа' }));
    expect(await screen.findByRole('dialog', { name: 'Как прошла работа' })).toBeInTheDocument();
  }, 20000);

  test('marks the job somebody wrote about, and no other', () => {
    unread.tasks.add(id(2));
    render(<TasksView />);

    expect(within(rowOf('Вечерний осмотр')).getByText('Новое сообщение')).toBeInTheDocument();
    expect(
      within(rowOf('Генеральная уборка')).queryByText('Новое сообщение'),
    ).not.toBeInTheDocument();
  });

  test('the mark opens the conversation it is about', async () => {
    unread.tasks.add(id(2));
    render(<TasksView />);

    await userEvent.click(
      within(rowOf('Вечерний осмотр')).getByRole('button', {
        name: /^Новое сообщение — открыть чат: Вечерний осмотр/,
      }),
    );

    expect(await screen.findByRole('dialog', { name: 'Чат' })).toHaveTextContent(id(2));
  });

  // Decision 14: on a phone the page never scrolls sideways; the table does, in its frame.
  test('the table scrolls sideways within its own frame', () => {
    const { container } = render(<TasksView />);

    expect(container.querySelector('[data-slot="table-container"]')).toHaveClass('overflow-x-auto');
  });
});

describe('TasksView keeps its tab and filters in the address', () => {
  test('opens on the tab and the filters a link names', () => {
    window.history.replaceState(null, '', '/tasks?tab=upcoming&type=cleaning&assignee=nobody');

    render(<TasksView />);

    expect(screen.getByRole('tab', { name: /Ближайшие/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Тип')).toHaveValue('cleaning');
    expect(screen.getByLabelText('Исполнитель')).toHaveValue('nobody');
    expect(screen.getByText('Уборка завтра')).toBeInTheDocument();
  });

  test('writes every change into the address, and a reset takes the filters out of it', async () => {
    render(<TasksView />);

    await userEvent.click(screen.getByRole('tab', { name: /Завершённые/ }));
    expect(query()).toBe('tab=closed');

    await userEvent.selectOptions(screen.getByLabelText('Исполнитель'), 'Без исполнителя');
    await userEvent.type(screen.getByLabelText(/Поиск/), 'окна');
    expect(query()).toBe('tab=closed&q=%D0%BE%D0%BA%D0%BD%D0%B0&assignee=nobody');
    expect(screen.getByLabelText(/Поиск/)).toHaveValue('окна');

    await userEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(query()).toBe('tab=closed');
    expect(screen.getByRole('tab', { name: /Завершённые/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }, 20000);

  // Owner, 04.10: a tab is a step «Назад» walks back; the search and the filters are not.
  test('«Назад» from a tab returns to the tab before, with its filters, read from the address', async () => {
    render(<TasksView />);
    const steps = window.history.length;

    await userEvent.click(screen.getByRole('tab', { name: /Ближайшие/ }));
    await userEvent.click(screen.getByRole('tab', { name: /Завершённые/ }));
    expect(window.history.length).toBe(steps + 2);
    await userEvent.selectOptions(screen.getByLabelText('Тип'), 'Осмотр');
    await userEvent.type(screen.getByLabelText(/Поиск/), 'окна');
    expect(window.history.length).toBe(steps + 2);
    expect(query()).toBe('tab=closed&q=%D0%BE%D0%BA%D0%BD%D0%B0&type=inspection');

    await act(() => goBack());
    expect(query()).toBe('tab=upcoming');
    expect(screen.getByRole('tab', { name: /Ближайшие/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Тип')).toHaveValue('all');
    expect(screen.getByLabelText(/Поиск/)).toHaveValue('');

    await act(() => goBack());
    expect(screen.getByRole('tab', { name: /Сегодня/ })).toHaveAttribute('aria-selected', 'true');
  }, 20000);

  // Owner, 04.10: the menu's «Уборки» and the dashboard's tile lead to the bare
  // `/tasks` (their links are checked in sidebar.test and dashboard-view.test);
  // the screen remembers nothing of the last visit.
  test('the bare address opens the plain screen, whatever was filtered before', async () => {
    const first = render(<TasksView />);
    await userEvent.click(screen.getByRole('tab', { name: /Завершённые/ }));
    await userEvent.selectOptions(screen.getByLabelText('Исполнитель'), 'Без исполнителя');
    first.unmount();

    window.history.pushState(null, '', '/tasks');
    render(<TasksView />);

    expect(screen.getByRole('tab', { name: /Сегодня/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Исполнитель')).toHaveValue('all');
    expect(query()).toBe('');
  });

  test('a screen opened afresh on the written address is the screen that was left', async () => {
    const first = render(<TasksView />);
    await userEvent.click(screen.getByRole('tab', { name: /Ближайшие/ }));
    await userEvent.selectOptions(screen.getByLabelText('Тип'), 'Осмотр');
    first.unmount();

    // «Назад» from another section, or a reload: the page mounts on the address.
    render(<TasksView />);

    expect(screen.getByRole('tab', { name: /Ближайшие/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Тип')).toHaveValue('inspection');
  });
});
