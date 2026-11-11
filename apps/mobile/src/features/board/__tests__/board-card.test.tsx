import { SIGNAL_SOURCE_LOOK } from '@str-ops/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';
import { calendarDay } from '@/features/tasks/schema';
import { useColorScheme } from '@/hooks/use-color-scheme';
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

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
const scheme = jest.mocked(useColorScheme);

beforeEach(() => {
  scheme.mockReturnValue('light');
});

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

// The owner's decision 7 of 2026-10-31: every task from a guest signal says it
// was made automatically, and a manager's confirmation beside it.
describe('a task from a guest signal', () => {
  const facts = {
    kind: 'repair',
    subject: 'hot_water',
    channel: 'airbnb',
    period_month: '2026-10',
    mode: 'manager',
  } as const;

  test('a review a manager confirmed: the «Из отзыва» chip first, the month, its plaque, all heard', async () => {
    const problem = boardProblem({ source: 'review', source_facts: facts });

    await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} hasUnread />);

    const marks = screen.getByTestId('board-marks');
    expect(within(marks).getByText('Из отзыва')).toBeTruthy();
    // First in the row, before the new-message mark and the status.
    expect(marks.children[0]).toBe(screen.getByTestId('board-source'));
    expect(screen.getByText('Гость выехал: 2026-10')).toBeTruthy();
    expect(screen.getByText('Подтвердил менеджер')).toBeTruthy();
    expect(screen.queryByText('Создано автоматически')).toBeNull();
    expect(screen.queryByText('Из чата')).toBeNull();
    expect(
      screen.getByRole('button', {
        name:
          'Кран течёт. Из отзыва. Гость выехал: 2026-10. ' +
          'Подтвердил менеджер. CZ - Nadrazni Apt 6. Открыто. Без исполнителя. Новое сообщение',
      }),
    ).toBeTruthy();
  });

  test('a chat message made on its own: the «Из чата» chip and «Создано автоматически»', async () => {
    const problem = boardProblem({
      source: 'message',
      source_facts: { ...facts, mode: 'auto' },
    });

    await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

    const marks = screen.getByTestId('board-marks');
    expect(within(marks).getByText('Из чата')).toBeTruthy();
    expect(marks.children[0]).toBe(screen.getByTestId('board-source'));
    expect(screen.getByText('Отправлено: 2026-10')).toBeTruthy();
    expect(screen.getByText('Создано автоматически')).toBeTruthy();
    expect(screen.queryByText('Подтвердил менеджер')).toBeNull();
    expect(screen.queryByText('Из отзыва')).toBeNull();
    expect(
      screen.getByRole('button', {
        name:
          'Кран течёт. Из чата. Отправлено: 2026-10. Создано автоматически. ' +
          'CZ - Nadrazni Apt 6. Открыто. Без исполнителя',
      }),
    ).toBeTruthy();
  });

  test('a task somebody on the staff reported carries no chip', async () => {
    await render(
      <BoardCard problem={boardProblem({ source: 'staff' })} names={NAMES} onPress={jest.fn()} />,
    );

    expect(screen.queryByTestId('board-source')).toBeNull();
    expect(screen.queryByText(/Из отзыва|Из чата/)).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Кран течёт. CZ - Nadrazni Apt 6. Открыто. Без исполнителя',
      }),
    ).toBeTruthy();
  });

  test('dark theme: the chat chip is filled with the dark terracotta mark', async () => {
    scheme.mockReturnValue('dark');
    const problem = boardProblem({ source: 'message', source_facts: facts });

    await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

    const tone = Colors.dark.tone[SIGNAL_SOURCE_LOOK.message.tone];
    expect(chipFrame('board-source').backgroundColor).toBe(tone.mark);
    const word = StyleSheet.flatten(screen.getByText('Из чата').props.style) as TextStyle;
    expect(word.color).toBe(tone.onMark);
  });
});

test('an archived task carries its pill', async () => {
  const problem = boardProblem({ archived_at: '2026-10-06T08:00:00+00:00' });

  await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

  expect(screen.getByText('В архиве')).toBeTruthy();
});

/**
 * The panel's rule, from the same place (owner, 2026-11-05): a repair past its
 * day says, neutral, how many days it hangs, and is «Просрочено» from
 * OVERDUE_AFTER_DAYS on — the days counted in the listing's zone.
 */
describe('a repair whose day has passed', () => {
  /** `days` days before the phone's today, as `scheduled_date` writes it. */
  const daysAgo = (days: number) => calendarDay(new Date(), -days);

  test.each([
    [1, 'Висит 1 день'],
    [2, 'Висит 2 дня'],
  ])('%i day(s) on it hangs, neutral — not yet «Просрочено»', async (days, words) => {
    const problem = boardProblem({
      status: 'assigned',
      fix_tasks: [repair({ scheduled_date: daysAgo(days) })],
    });

    await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByText('Просрочено')).toBeNull();
    expect(chipFrame('board-hanging').borderColor).not.toBe(Colors.light.tone.overdue.border);
    expect(screen.getByRole('button').props.accessibilityLabel).toContain(words);
  });

  test('is «Просрочено» from the third day in the overdue tone — solid, not the dashed «Без исполнителя»', async () => {
    const problem = boardProblem({
      status: 'assigned',
      fix_tasks: [repair({ scheduled_date: daysAgo(3) })],
    });

    await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

    expect(screen.getByText('Просрочено')).toBeTruthy();
    expect(screen.getByText('Висит 3 дня')).toBeTruthy();
    expect(chipFrame('board-overdue')).toMatchObject({
      borderStyle: 'solid',
      borderColor: Colors.light.tone.overdue.border,
    });
    const label = screen.getByRole('button').props.accessibilityLabel;
    expect(label).toContain('Просрочено');
    expect(label).toContain('Висит 3 дня');
  });

  test('waiting for nobody three days on is overdue too', async () => {
    const problem = boardProblem({
      fix_tasks: [repair({ assignee_id: null, status: 'unassigned', scheduled_date: daysAgo(3) })],
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
        fix_tasks: [repair({ status: 'done', scheduled_date: calendarDay(new Date(), -5) })],
      }),
    ],
  ])('says nothing of days when it is %s', async (_when, problem) => {
    await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

    expect(screen.queryByText('Просрочено')).toBeNull();
    expect(screen.queryByText(/Висит/)).toBeNull();
  });

  describe("counted by the listing's calendar, not the phone's", () => {
    beforeEach(() => {
      // Only the clock is faked: the render still waits on real timers.
      jest.useFakeTimers({
        doNotFake: [
          'hrtime',
          'nextTick',
          'performance',
          'queueMicrotask',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'requestIdleCallback',
          'cancelIdleCallback',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
        ],
      });
      // 11:00 UTC on 04.11 is already 01:00 on 05.11 on Kiritimati (UTC+14),
      // while a phone anywhere from UTC-11 to UTC+12 still has 04.11.
      jest.setSystemTime(new Date('2026-11-04T11:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    test('a repair of 02.11 on a listing whose today is 05.11 is overdue', async () => {
      const problem = boardProblem({
        status: 'assigned',
        property: {
          name: 'CZ - Nadrazni Apt 6',
          hostaway_unit_id: null,
          timezone: 'Pacific/Kiritimati',
          parent: null,
        },
        fix_tasks: [repair({ scheduled_date: '2026-11-02' })],
      });

      await render(<BoardCard problem={problem} names={NAMES} onPress={jest.fn()} />);

      expect(screen.getByText('Просрочено')).toBeTruthy();
      expect(screen.getByText('Висит 3 дня')).toBeTruthy();
    });
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
