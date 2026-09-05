import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TaskStep } from '@/features/steps/schema';

import { TaskDetail } from '../task-detail';
import type { CleaningTask } from '../schema';

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function task(overrides: Partial<CleaningTask> = {}): CleaningTask {
  return {
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    status: 'assigned',
    priority: 0,
    scheduled_date: '2026-11-10',
    due_at: null,
    assignee_id: ME,
    property_id: 412432,
    property: { name: 'CZ - Nadrazni Apt 6', cleaner_notes: 'Ключ в ящике 4325' },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: 4,
    started_at: null,
    completed_at: null,
    is_parallel: false,
    ...overrides,
  };
}

const actions = {
  onStart: jest.fn(),
  onFinish: jest.fn(),
  onClaim: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('shows what the cleaner needs to plan by: window, guests, notes', async () => {
  await render(<TaskDetail task={task()} userId={ME} isBusy={false} error={null} {...actions} />);

  expect(screen.getByText(/10:00–15:00/)).toBeTruthy();
  expect(screen.getByText('4')).toBeTruthy();
  expect(screen.getByText('Ключ в ящике 4325')).toBeTruthy();
});

test('offers to start a task assigned to her', async () => {
  await render(<TaskDetail task={task()} userId={ME} isBusy={false} error={null} {...actions} />);

  await fireEvent.press(screen.getByRole('button', { name: 'Начать уборку' }));

  expect(actions.onStart).toHaveBeenCalledWith('3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b');
  expect(screen.queryByRole('button', { name: 'Завершить уборку' })).toBeNull();
});

test('offers to finish a task she has started', async () => {
  await render(
    <TaskDetail
      task={task({ status: 'in_progress', started_at: '2026-11-10T08:05:00+00:00' })}
      userId={ME}
      isBusy={false}
      error={null}
      {...actions}
    />,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Завершить уборку' }));

  expect(actions.onFinish).toHaveBeenCalledWith('3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b');
  expect(screen.queryByRole('button', { name: 'Начать уборку' })).toBeNull();
});

test('offers to take a free task instead of starting it', async () => {
  await render(
    <TaskDetail
      task={task({ status: 'unassigned', assignee_id: null })}
      userId={ME}
      isBusy={false}
      error={null}
      {...actions}
    />,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Взять' }));

  expect(actions.onClaim).toHaveBeenCalledWith('3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b');
});

test('offers nothing on a colleague task and says whose it is', async () => {
  await render(
    <TaskDetail
      task={task({ assignee_id: 'a1b2c3d4-2222-4222-8222-a1b2c3d40002' })}
      userId={ME}
      isBusy={false}
      error={null}
      {...actions}
    />,
  );

  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('Уборку выполняет коллега')).toBeTruthy();
});

test('says when a finished task is finished', async () => {
  await render(
    <TaskDetail
      task={task({
        status: 'done',
        started_at: '2026-11-10T08:00:00+00:00',
        completed_at: '2026-11-10T10:00:00+00:00',
      })}
      userId={ME}
      isBusy={false}
      error={null}
      {...actions}
    />,
  );

  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('Уборка завершена')).toBeTruthy();
});

test('does not fire twice while an action is in flight', async () => {
  await render(<TaskDetail task={task()} userId={ME} isBusy error={null} {...actions} />);

  await fireEvent.press(screen.getByRole('button', { name: 'Начать уборку' }));

  expect(actions.onStart).not.toHaveBeenCalled();
});

describe('the process', () => {
  const running = task({ status: 'in_progress', started_at: '2026-11-10T08:05:00+00:00' });

  function step(overrides: Partial<TaskStep> = {}): TaskStep {
    return {
      id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
      task_id: running.id,
      sort_order: 1,
      type: 'confirmation',
      required: false,
      title: 'Финальная проверка',
      instructions: null,
      started_at: null,
      completed_at: null,
      completed_by: null,
      payload: {},
      skipped_at: null,
      skip_reason: null,
      waived_at: null,
      waive_reason: null,
      ...overrides,
    };
  }

  test('lists the steps of a task under way and opens the one pressed', async () => {
    const onOpenStep = jest.fn();
    await render(
      <TaskDetail
        task={running}
        userId={ME}
        isBusy={false}
        error={null}
        steps={[step()]}
        onOpenStep={onOpenStep}
        {...actions}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: /Финальная проверка/ }));

    expect(onOpenStep).toHaveBeenCalledWith('b1c2d3e4-1111-4111-8111-b1c2d3e40001');
  });

  test('holds the finish while a required step is open, and says how many', async () => {
    await render(
      <TaskDetail
        task={running}
        userId={ME}
        isBusy={false}
        error={null}
        steps={[step({ required: true }), step({ id: 'b1c2d3e4-2222-4222-8222-b1c2d3e40002' })]}
        {...actions}
      />,
    );

    const finish = screen.getByRole('button', { name: 'Завершить уборку' });
    expect(finish).toBeDisabled();
    expect(screen.getByText('Обязательных шагов осталось: 1')).toBeTruthy();

    await fireEvent.press(finish);

    expect(actions.onFinish).not.toHaveBeenCalled();
  });

  test('lets her finish once required steps are done or waived, optional ones untouched', async () => {
    await render(
      <TaskDetail
        task={running}
        userId={ME}
        isBusy={false}
        error={null}
        steps={[
          step({ required: true, completed_at: '2026-11-10T08:30:00+00:00' }),
          step({
            id: 'b1c2d3e4-2222-4222-8222-b1c2d3e40002',
            required: true,
            waived_at: '2026-11-10T08:31:00+00:00',
            waive_reason: 'нет заметки',
          }),
          step({ id: 'b1c2d3e4-3333-4333-8333-b1c2d3e40003' }),
        ]}
        {...actions}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Завершить уборку' }));

    expect(actions.onFinish).toHaveBeenCalledWith(running.id);
    expect(screen.queryByText(/Обязательных шагов осталось/)).toBeNull();
  });
});

test('shows the reason when the last action failed, and lets her retry', async () => {
  await render(
    <TaskDetail
      task={task()}
      userId={ME}
      isBusy={false}
      error={new Error('Нет соединения')}
      {...actions}
    />,
  );

  expect(screen.getByText('Нет соединения')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Начать уборку' })).toBeTruthy();
});
