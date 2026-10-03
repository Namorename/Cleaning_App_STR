import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

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
    property: {
      name: 'CZ - Nadrazni Apt 6',
      address: 'Nádražní 6',
      hostaway_unit_id: null,
      effective_cleaner_notes: null,
      parent: null,
    },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: null,
    started_at: null,
    completed_at: null,
    is_parallel: false,
    type: 'cleaning',
    notes: null,
    title: null,
    title_i18n: {},
  };
}

test('says it is loading rather than showing an empty list', async () => {
  await render(<TaskList {...baseProps} sections={undefined} isLoading error={null} />);

  expect(screen.getByText('Загружаем уборки…')).toBeTruthy();
  expect(screen.queryByText('Свободных уборок нет.')).toBeNull();
});

test('distinguishes a failure from an empty day', async () => {
  await render(
    <TaskList
      {...baseProps}
      sections={undefined}
      isLoading={false}
      error={new Error('Network request failed')}
    />,
  );

  expect(screen.getByText('Не удалось загрузить уборки')).toBeTruthy();
  expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
  expect(screen.getByText('Network request failed')).toBeTruthy();
  expect(screen.queryByText('Свободных уборок нет.')).toBeNull();
});

test('a list that never loaded can be pulled down, as its line says', async () => {
  // Arrange
  const onRefresh = jest.fn();
  await render(
    <TaskList
      {...baseProps}
      onRefresh={onRefresh}
      sections={undefined}
      isLoading={false}
      error={new Error('Network request failed')}
    />,
  );
  expect(screen.getByText('Потяните список вниз, чтобы повторить.')).toBeTruthy();
  const pulls = screen.container.queryAll((node) => node.type === 'RCTRefreshControl');
  expect(pulls).toHaveLength(1);

  // Act
  await fireEvent(pulls[0], 'refresh');

  // Assert
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

// A refresh that fails in a stairwell must not take away the list she had a
// minute ago: yesterday's cards stay, and a line above them says what happened.
test('a failed refresh keeps the list it had, with the failure said above it', async () => {
  await render(
    <TaskList
      {...baseProps}
      sections={[{ key: 'upcoming', data: [task()] }]}
      isLoading={false}
      error={new Error('Network request failed')}
    />,
  );

  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
  expect(
    screen.getByText('Не удалось обновить, показано сохранённое. Потяните вниз, чтобы повторить.'),
  ).toBeTruthy();
  expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
  expect(screen.getByText('Network request failed')).toBeTruthy();
  expect(screen.queryByText('Не удалось загрузить уборки')).toBeNull();
});

test('the failure line sits with what the screen puts above the cards', async () => {
  await render(
    <TaskList
      {...baseProps}
      sections={[{ key: 'upcoming', data: [task()] }]}
      isLoading={false}
      error={new Error('Network request failed')}
      header={<Text>Эту уборку с вас сняли.</Text>}
    />,
  );

  expect(screen.getByText('Эту уборку с вас сняли.')).toBeTruthy();
  expect(
    screen.getByText('Не удалось обновить, показано сохранённое. Потяните вниз, чтобы повторить.'),
  ).toBeTruthy();
});

test('an empty list whose refresh failed says both: nothing to do, and the failure above', async () => {
  await render(
    <TaskList
      {...baseProps}
      sections={[]}
      isLoading={false}
      error={new Error('Network request failed')}
    />,
  );

  expect(screen.getByText('Свободных уборок нет.')).toBeTruthy();
  expect(
    screen.getByText('Не удалось обновить, показано сохранённое. Потяните вниз, чтобы повторить.'),
  ).toBeTruthy();
  expect(screen.getByText('Network request failed')).toBeTruthy();
  expect(screen.queryByText('Не удалось загрузить уборки')).toBeNull();
});

test('shows the empty message when there is genuinely nothing to do', async () => {
  await render(<TaskList {...baseProps} sections={[]} isLoading={false} error={null} />);

  expect(screen.getByText('Свободных уборок нет.')).toBeTruthy();
});

test('draws what the screen puts above the cards', async () => {
  await render(
    <TaskList
      {...baseProps}
      sections={[{ key: 'upcoming', data: [task()] }]}
      isLoading={false}
      error={null}
      header={<Text>Эту уборку с вас сняли.</Text>}
    />,
  );

  expect(screen.getByText('Эту уборку с вас сняли.')).toBeTruthy();
  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
});

test('renders the tasks it was given', async () => {
  await render(
    <TaskList
      {...baseProps}
      sections={[{ key: 'upcoming', data: [task()] }]}
      isLoading={false}
      error={null}
    />,
  );

  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
});

test('names the group of cleanings under way so she can find them', async () => {
  await render(
    <TaskList
      {...baseProps}
      sections={[
        { key: 'running', data: [task()] },
        { key: 'upcoming', data: [] },
      ]}
      isLoading={false}
      error={null}
    />,
  );

  expect(screen.getByText('В работе')).toBeTruthy();
});
