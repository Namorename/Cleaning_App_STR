import { render, screen } from '@testing-library/react-native';

import { TaskList } from '../task-list';
import type { CleaningTask } from '../schema';

const noop = () => {};

const baseProps = {
  onRefresh: noop,
  isRefreshing: false,
  emptyMessage: 'Свободных уборок нет.',
};

function task(): CleaningTask {
  return {
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    status: 'unassigned',
    priority: 0,
    scheduled_date: '2026-11-10',
    due_at: null,
    assignee_id: null,
    property_id: 412432,
    property: { name: 'CZ - Nadrazni Apt 6' },
  };
}

test('says it is loading rather than showing an empty list', async () => {
  await render(<TaskList {...baseProps} tasks={undefined} isLoading error={null} />);

  expect(screen.getByText('Загружаем задачи…')).toBeTruthy();
  expect(screen.queryByText('Свободных уборок нет.')).toBeNull();
});

test('distinguishes a failure from an empty day', async () => {
  await render(
    <TaskList
      {...baseProps}
      tasks={undefined}
      isLoading={false}
      error={new Error('сеть недоступна')}
    />,
  );

  expect(screen.getByText('Не удалось загрузить задачи')).toBeTruthy();
  expect(screen.getByText('сеть недоступна')).toBeTruthy();
  expect(screen.queryByText('Свободных уборок нет.')).toBeNull();
});

test('shows the empty message when there is genuinely nothing to do', async () => {
  await render(<TaskList {...baseProps} tasks={[]} isLoading={false} error={null} />);

  expect(screen.getByText('Свободных уборок нет.')).toBeTruthy();
});

test('renders the tasks it was given', async () => {
  await render(<TaskList {...baseProps} tasks={[task()]} isLoading={false} error={null} />);

  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
});
