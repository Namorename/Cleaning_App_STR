import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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
  assignee: { full_name: 'Maria Test' },
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
  assignee: { full_name: 'Maria Test' },
});

const staff = [{ id: MARIA, full_name: 'Maria Test', role: 'cleaner' }];
const properties = [{ id: 1, name: 'Vinohrady 12' }];

const useTasks = vi.fn();
const saveTask = vi.fn();
const cancelTask = vi.fn();
const setDuration = vi.fn();
const saveState = { isPending: false, isError: false, error: null as unknown };
const idle = { isPending: false, isError: false, error: null, reset: vi.fn() };

vi.mock('../use-tasks', () => ({
  useTasks: () => useTasks(),
  useStaff: () => ({ data: staff, isPending: false, isError: false }),
  useProperties: () => ({ data: properties, isPending: false, isError: false }),
  useCompanyLanguage: () => ({ data: 'ru', isPending: false, isError: false }),
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
      photosByStep: {},
    },
    isPending: false,
    isError: false,
  }),
  useTaskProblems: () => ({ data: [], isPending: false, isError: false }),
  useSaveTask: () => ({ ...saveState, mutate: saveTask, reset: idle.reset }),
  useCancelTask: () => ({ ...idle, mutate: cancelTask }),
  useSetDuration: () => ({ ...idle, mutate: setDuration }),
}));

import { TasksView } from '../tasks-view';

beforeEach(() => {
  vi.clearAllMocks();
  saveState.isError = false;
  saveState.error = null;
  useTasks.mockReturnValue({
    data: [morning, evening, upcoming, finished],
    isPending: false,
    isError: false,
  });
});

describe('TasksView', () => {
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

  test('switches to the days ahead and marks where a task came from', async () => {
    render(<TasksView />);

    await userEvent.click(screen.getByRole('tab', { name: /Ближайшие/ }));
    const card = screen.getByText('Уборка завтра').closest('[data-slot="card"]') as HTMLElement;
    expect(card).toHaveTextContent('Из брони');
    // A task from a booking is not the manager's to call off.
    expect(
      within(card).queryByRole('button', { name: 'Отменить задание' }),
    ).not.toBeInTheDocument();
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

  test('says nothing was found rather than that there is no work', async () => {
    render(<TasksView />);

    await userEvent.type(screen.getByLabelText(/Поиск/), 'ничего такого');
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
  });

  test('writes a new task through the form', async () => {
    render(<TasksView />);

    await userEvent.click(screen.getByRole('button', { name: 'Новое задание' }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.selectOptions(within(dialog).getByLabelText('Объект'), 'Vinohrady 12');
    await userEvent.type(within(dialog).getByLabelText(/Название \(русский\)/), 'Мойка окон');
    await userEvent.type(within(dialog).getByLabelText('Перевод: английский'), 'Windows');
    await userEvent.selectOptions(within(dialog).getByLabelText('Исполнитель'), 'Maria Test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    expect(saveTask).toHaveBeenCalledWith(
      {
        draft: expect.objectContaining({
          propertyId: 1,
          type: 'cleaning',
          title: 'Мойка окон',
          titleI18n: { en: 'Windows' },
          assigneeId: MARIA,
        }),
      },
      expect.anything(),
    );
  }, 20000);

  test('offers to put a duplicate there anyway, and only after the refusal', async () => {
    saveState.isError = true;
    saveState.error = { hint: 'serverErrors.taskDuplicate', details: '{"date":"2026-09-11"}' };
    render(<TasksView />);

    await userEvent.click(screen.getByRole('button', { name: 'Новое задание' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Объект'), 'Vinohrady 12');
    await userEvent.type(within(dialog).getByLabelText(/Название \(русский\)/), 'Мойка окон');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Всё равно создать' }));
    expect(saveTask).toHaveBeenCalledWith(
      { draft: expect.anything(), allowDuplicate: true },
      expect.anything(),
    );
  }, 20000);

  test('calls a task off only after the question is answered', async () => {
    render(<TasksView />);
    const card = screen.getByText('Вечерний осмотр').closest('[data-slot="card"]') as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: 'Отменить задание' }));
    expect(cancelTask).not.toHaveBeenCalled();
    await userEvent.click(within(card).getByRole('button', { name: 'Да, отменить' }));
    expect(cancelTask).toHaveBeenCalledWith(id(2));
  });

  test('reads a finished cleaning and corrects the time without touching the measurement', async () => {
    render(<TasksView />);

    await userEvent.click(screen.getByRole('tab', { name: /Завершённые/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Как прошла уборка' }));

    const drawer = await screen.findByRole('dialog');
    expect(drawer).toHaveTextContent('Замер: 1 ч 35 мин');
    expect(drawer).toHaveTextContent('Фото после уборки');

    await userEvent.type(within(drawer).getByLabelText('Корректировка, минут'), '80');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Сохранить' }));
    expect(setDuration).toHaveBeenCalledWith({ taskId: id(4), minutes: 80 });
  }, 20000);
});
