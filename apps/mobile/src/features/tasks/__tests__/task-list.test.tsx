import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type TextStyle } from 'react-native';

import { FontSize } from '@/constants/theme';
import { setWordContext } from '@/testing/word-context';

import { TaskList } from '../task-list';
import { calendarDay, type CleaningTask, type TaskGroup } from '../schema';

const noop = () => {};

const baseProps = {
  onRefresh: noop,
  isRefreshing: false,
  emptyMessage: 'Свободных уборок нет.',
};

function task(overrides: Partial<CleaningTask> = {}): CleaningTask {
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
    ...overrides,
  };
}

test('says it is loading rather than showing an empty list', async () => {
  await render(<TaskList {...baseProps} sections={undefined} isLoading error={null} />);

  // Said as loading: the label of the skeleton that stands in for the cards.
  expect(screen.getByRole('progressbar', { name: 'Загружаем уборки…' })).toBeTruthy();
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

test('a list that never loaded can still be pulled down, like the list it stands in for', async () => {
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
  const pulls = screen.container.queryAll((node) => node.type === 'RCTRefreshControl');
  expect(pulls).toHaveLength(1);

  // Act
  await fireEvent(pulls[0], 'refresh');

  // Assert
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

test('a list that never loaded offers «Повторить», which asks again', async () => {
  // Arrange: the pull is not something a screen reader finds; a button is.
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

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

  // Assert
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

// A refresh that fails in a stairwell must not take away the list she had a
// minute ago: yesterday's cards stay, and a line above them says what happened.
test('a failed refresh keeps the list it had, with the failure said above it', async () => {
  await render(
    <TaskList
      {...baseProps}
      sections={[{ kind: 'day', key: '2026-11-10', data: [task()] }]}
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
      sections={[{ kind: 'day', key: '2026-11-10', data: [task()] }]}
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
      sections={[{ kind: 'day', key: '2026-11-10', data: [task()] }]}
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
      sections={[{ kind: 'day', key: '2026-11-10', data: [task()] }]}
      isLoading={false}
      error={null}
    />,
  );

  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
});

/** A section of one planned day. */
function day(date: string, data: CleaningTask[]): TaskGroup {
  return { kind: 'day', key: date, data };
}

const SECOND_ID = '9d2ff806-4bea-4aa5-be3c-1b07a629dbee';
const THIRD_ID = 'c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

describe('sections by day', () => {
  test('a heading per day, read as a heading: today, tomorrow, then the weekday and date', async () => {
    // Arrange: dates from the phone's own calendar, as the list reads them.
    const now = new Date();
    await render(
      <TaskList
        {...baseProps}
        sections={[
          day(calendarDay(now), [task()]),
          day(calendarDay(now, 1), [task({ id: SECOND_ID })]),
          day(calendarDay(now, 2), [task({ id: THIRD_ID })]),
        ]}
        isLoading={false}
        error={null}
      />,
    );

    // Assert
    expect(screen.getByRole('header', { name: 'Сегодня' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Завтра' })).toBeTruthy();
    expect(screen.getAllByRole('header')).toHaveLength(3);
    expect(screen.getAllByRole('header')[2].props.children).toMatch(
      /^[А-Я][а-я]+, \d{1,2} [а-я]+$/,
    );
  });

  test('the headings stay on top while the day under them scrolls', async () => {
    await render(
      <TaskList
        {...baseProps}
        sections={[day('2026-11-10', [task()]), day('2026-11-11', [task({ id: SECOND_ID })])]}
        isLoading={false}
        error={null}
      />,
    );

    const sticky = screen.container.queryAll(
      (node) => typeof node.type === 'string' && (node.props.stickyHeaderIndices?.length ?? 0) > 0,
    );
    expect(sticky).toHaveLength(1);
  });
});

describe('the work under way', () => {
  const running = task({ status: 'in_progress' });

  test('is a section of its own, named so she can find it, and read as a heading', async () => {
    await render(
      <TaskList
        {...baseProps}
        sections={[
          { kind: 'running', key: 'running', data: [running] },
          day('2026-11-11', [task({ id: SECOND_ID })]),
        ]}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByRole('header', { name: 'В работе' })).toBeTruthy();
  });

  test('every card in it is the current one: several can run at once', async () => {
    await render(
      <TaskList
        {...baseProps}
        sections={[
          { kind: 'running', key: 'running', data: [running, { ...running, id: SECOND_ID }] },
          day('2026-11-11', [task({ id: THIRD_ID })]),
        ]}
        isLoading={false}
        error={null}
        onPress={noop}
      />,
    );

    expect(screen.getAllByText('Сейчас')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Сейчас\./ })).toHaveLength(2);
  });

  test('a card of a day is not the current one', async () => {
    await render(
      <TaskList
        {...baseProps}
        sections={[day('2026-11-11', [task()])]}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.queryByText('Сейчас')).toBeNull();
  });
});

describe('loading, a list that never loaded and an empty one, on the «Абрикос» components', () => {
  function styleOf(element: { props: { style?: unknown } }): TextStyle {
    return StyleSheet.flatten(element.props.style as TextStyle);
  }

  test('while it loads, the cards’ shape stands in for them, busy', async () => {
    await render(<TaskList {...baseProps} sections={undefined} isLoading error={null} />);

    const loading = screen.getByRole('progressbar', { name: 'Загружаем уборки…' });
    expect(loading.props.accessibilityState).toMatchObject({ busy: true });
  });

  test('a list that never loaded is the error state: titled, the reason as an alert', async () => {
    await render(
      <TaskList
        {...baseProps}
        sections={undefined}
        isLoading={false}
        error={new Error('Network request failed')}
      />,
    );

    expect(styleOf(screen.getByText('Не удалось загрузить уборки')).fontSize).toBe(FontSize.title);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(styleOf(screen.getByText('Network request failed')).fontSize).toBe(FontSize.caption);
  });

  test('an empty list is the empty state, titled', async () => {
    await render(<TaskList {...baseProps} sections={[]} isLoading={false} error={null} />);

    expect(styleOf(screen.getByText('Свободных уборок нет.')).fontSize).toBe(FontSize.title);
  });
});

// His own work, read in his words (docs/tech-plan.md §6).
describe('read by a technician', () => {
  beforeEach(async () => {
    await setWordContext('tech');
  });

  afterEach(async () => {
    await setWordContext(undefined);
  });

  test('his list loads as work', async () => {
    await render(<TaskList {...baseProps} sections={undefined} isLoading error={null} />);

    expect(screen.getByRole('progressbar', { name: 'Загружаем работы…' })).toBeTruthy();
  });

  test('his list that never loaded says so as work', async () => {
    await render(
      <TaskList
        {...baseProps}
        sections={undefined}
        isLoading={false}
        error={new Error('Network request failed')}
      />,
    );

    expect(screen.getByText('Не удалось загрузить работы')).toBeTruthy();
    expect(screen.queryByText(/уборк/i)).toBeNull();
  });
});
