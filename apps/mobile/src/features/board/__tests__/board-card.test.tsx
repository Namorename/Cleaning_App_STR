import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';
import { calendarDay } from '@/features/tasks/schema';
import { i18n } from '@/i18n';
import {
  CLEANER_ANNA,
  PROBLEM_ID,
  STAFF,
  TECH_IVAN,
  boardProblem,
  repair,
} from '@/testing/board-fixtures';

import { BoardCard } from '../board-card';
import { staffNames } from '../format';

/**
 * One task on the head technician's board (brief item 1): its title, its
 * status as a pill in its tone, where it is, who holds its live repair and for
 * which day. Nobody on it is said in the «Без исполнителя» tone — the dashed
 * frame of decision 3 — and only while somebody still has to see to it.
 */

const NAMES = staffNames(STAFF, i18n.t);

/** The pill's frame says the tone by shape, not colour alone. */
function chipFrame(testID: string): ViewStyle {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) as ViewStyle;
}

test('a held task: title, status, place, the person and the day', async () => {
  const problem = boardProblem({
    status: 'assigned',
    fix_tasks: [repair({ time_from: '10:00:00', time_to: '12:00:00' })],
  });

  await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

  expect(screen.getByText('Кран течёт')).toBeTruthy();
  expect(screen.getByText('Назначено')).toBeTruthy();
  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
  expect(screen.getByText('Иван Петров')).toBeTruthy();
  expect(screen.getByText('Сегодня · 10:00–12:00')).toBeTruthy();
  expect(screen.queryByText('Без исполнителя')).toBeNull();
});

test('the reader hears the card’s facts in one line', async () => {
  const problem = boardProblem({ status: 'assigned', fix_tasks: [repair()] });

  await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

  expect(
    screen.getByRole('button', {
      name: 'Кран течёт. CZ - Nadrazni Apt 6. Назначено. Иван Петров. Сегодня',
    }),
  ).toBeTruthy();
});

test('an open task nobody holds says so in the unassigned tone, dashed', async () => {
  await render(<BoardCard problem={boardProblem()} names={NAMES} onPress={jest.fn()} />);

  expect(screen.getByText('Без исполнителя')).toBeTruthy();
  expect(chipFrame('board-nobody')).toMatchObject({
    borderStyle: 'dashed',
    borderColor: Colors.light.tone.unassigned.border,
  });
});

test.each(['resolved', 'cancelled'] as const)(
  'a %s task waits for nobody, so it is not said to be without one',
  async (status) => {
    await render(
      <BoardCard problem={boardProblem({ status })} names={NAMES} onPress={jest.fn()} />,
    );

    expect(screen.queryByText('Без исполнителя')).toBeNull();
  },
);

test('a cleaner holding a repair is named like anybody (decision 17)', async () => {
  const problem = boardProblem({
    status: 'in_progress',
    fix_tasks: [repair({ assignee_id: CLEANER_ANNA, status: 'in_progress' })],
  });

  await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

  expect(screen.getByText('Анна Белова')).toBeTruthy();
  expect(screen.getByText('В работе')).toBeTruthy();
});

test('a person the directory does not know is a neutral word, never an id', async () => {
  const problem = boardProblem({
    status: 'assigned',
    fix_tasks: [repair({ assignee_id: 'f0f0f0f0-0000-4000-8000-000000000000' })],
  });

  await render(<BoardCard problem={problem} names={new Map()} onPress={jest.fn()} />);

  expect(screen.getByText('Сотрудник')).toBeTruthy();
});

test('an urgent task carries «Срочно» while somebody still has to see to it', async () => {
  await render(
    <BoardCard problem={boardProblem({ priority: 'high' })} names={NAMES} onPress={jest.fn()} />,
  );

  expect(screen.getByText('Срочно')).toBeTruthy();
});

// Red is for what still needs doing (decision 3): a closed or archived task
// is history, however urgent it was.
test.each([
  ['archived', { archived_at: '2026-10-06T08:00:00+00:00' }],
  ['resolved', { status: 'resolved' as const, fix_tasks: [repair({ status: 'done' })] }],
  ['cancelled', { status: 'cancelled' as const }],
])('an urgent task that is %s says nothing urgent', async (_kind, overrides) => {
  const problem = boardProblem({ priority: 'high', ...overrides });

  await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

  expect(screen.queryByText('Срочно')).toBeNull();
});

test('an archived task carries its pill', async () => {
  const problem = boardProblem({ archived_at: '2026-10-06T08:00:00+00:00' });

  await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

  expect(screen.getByText('В архиве')).toBeTruthy();
});

describe('a repair whose day has passed', () => {
  const yesterday = calendarDay(new Date(), -1);

  test('is «Просрочено» in the overdue tone — solid, not the dashed «Без исполнителя»', async () => {
    const problem = boardProblem({
      status: 'assigned',
      fix_tasks: [repair({ scheduled_date: yesterday })],
    });

    await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

    expect(screen.getByText('Просрочено')).toBeTruthy();
    expect(chipFrame('board-overdue')).toMatchObject({
      borderStyle: 'solid',
      borderColor: Colors.light.tone.overdue.border,
    });
    expect(screen.getByRole('button').props.accessibilityLabel).toContain('Просрочено');
  });

  test('waiting for nobody since then is overdue too', async () => {
    const problem = boardProblem({
      fix_tasks: [repair({ assignee_id: null, status: 'unassigned', scheduled_date: yesterday })],
    });

    await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

    expect(screen.getByText('Просрочено')).toBeTruthy();
  });

  test.each([
    ['today', boardProblem({ status: 'assigned', fix_tasks: [repair()] })],
    [
      'done',
      boardProblem({
        status: 'resolved',
        fix_tasks: [repair({ status: 'done', scheduled_date: yesterday })],
      }),
    ],
  ])('is not overdue when it is %s', async (_when, problem) => {
    await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

    expect(screen.queryByText('Просрочено')).toBeNull();
  });
});

test('hours with a start only read «с 10:00»', async () => {
  const problem = boardProblem({
    status: 'assigned',
    fix_tasks: [repair({ time_from: '10:00:00' })],
  });

  await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

  expect(screen.getByText('Сегодня · с 10:00')).toBeTruthy();
});

test('a press opens the task', async () => {
  const onPress = jest.fn();

  await render(<BoardCard problem={boardProblem()} names={NAMES} onPress={onPress} />);
  await fireEvent.press(screen.getByRole('button'));

  expect(onPress).toHaveBeenCalledWith(PROBLEM_ID);
});

test('names come from the directory by id', () => {
  expect(NAMES.get(TECH_IVAN)).toBe('Иван Петров');
});
