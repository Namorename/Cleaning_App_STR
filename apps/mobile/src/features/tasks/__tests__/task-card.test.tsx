import { SIZE, THEME_COLORS, TONE_COLORS, TOUCH_TARGET } from '@str-ops/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { TaskCard } from '../task-card';
import { calendarDay, type CleaningTask } from '../schema';

/**
 * A cleaning as one row of a list (5.4, «Списки уборок», variant 1): the
 * window large on the left with the check-in under it, the place and one quiet
 * line in the middle, and «Взять» / «Принять» as a button of its own on the
 * right. The day is the section's heading, not the row's.
 */

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

const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const OTHER_ID = '9d2ff806-4bea-4aa5-be3c-1b07a629dbee';

/** A same-day turnover: the next guest checks in at 13:00 UTC. */
const turnover = (overrides: Partial<CleaningTask> = {}) =>
  task({ priority: 1, due_at: '2026-11-10T13:00:00+00:00', ...overrides });

function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
}

describe('the place', () => {
  test('shows the listing name the cleaner would recognise', async () => {
    await render(<TaskCard task={task()} />);

    expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
  });

  test('the house and the room in it read as one place, the house first', async () => {
    // Arrange: a cleaning standing on a room of a multi-unit listing. "1 - 2109"
    // is the only name the row carries and it names no house at all.
    const inRoom = task({
      property: {
        name: '1 - 2109',
        address: 'Vinohradská 2109/10',
        hostaway_unit_id: 18007,
        effective_cleaner_notes: null,
        parent: { name: 'CZ - Vinohradska Royal Apt 1.3.5.7' },
      },
    });

    // Act
    await render(<TaskCard task={inRoom} />);

    // Assert
    expect(screen.getByText('CZ - Vinohradska Royal Apt 1.3.5.7 · 1 - 2109')).toBeTruthy();
  });

  test('a fix on a room is named by what is broken, and says which flat in which house', async () => {
    // A maintenance row is titled by the problem, so the flat lives in the line
    // under it — and that line has to carry the house, not just "1 - 2109".
    const fix = task({
      type: 'maintenance',
      problem: {
        id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
        title: 'Течёт кран',
        priority: 'high',
      },
      property: {
        name: '1 - 2109',
        address: 'Vinohradská 2109/10',
        hostaway_unit_id: 18007,
        effective_cleaner_notes: null,
        parent: { name: 'CZ - Vinohradska Royal Apt 1.3.5.7' },
      },
    });

    await render(<TaskCard task={fix} />);

    expect(screen.getByText('Течёт кран')).toBeTruthy();
    expect(screen.getByText(/CZ - Vinohradska Royal Apt 1\.3\.5\.7 — 1 - 2109/)).toBeTruthy();
  });

  test('a task whose listing did not come with it is still named by its id', async () => {
    await render(<TaskCard task={task({ property: null })} />);

    expect(screen.getByText('Объект 412432')).toBeTruthy();
  });
});

describe('the two times', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('the window: the start large, the end smaller under it', async () => {
    await render(<TaskCard task={task({ time_from: '10:00:00', time_to: '15:00:00' })} />);

    const start = styleOf(screen.getByText('10:00'));
    const end = styleOf(screen.getByText('–15:00'));
    expect(start.fontSize).toBeGreaterThan(end.fontSize ?? 0);
  });

  test('the check-in sits with the window, so the two times are read together', async () => {
    await render(<TaskCard task={turnover()} />);

    const window = screen.getByTestId('task-window');
    expect(within(window).getByText('10:00')).toBeTruthy();
    expect(within(window).getByText(/^В \d{2}:\d{2} заезд$/)).toBeTruthy();
  });

  test('states the check-in once, and never as a tail of the window', async () => {
    await render(<TaskCard task={turnover()} />);

    expect(screen.getAllByText(/заезд/)).toHaveLength(1);
    expect(screen.queryByText(/ · до \d{2}:\d{2}/)).toBeNull();
  });

  /** The phone's font at `fontScale`, on a 390 dp screen. */
  const atFontScale = (fontScale: number) =>
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });

  test('the column of the times grows with the system font, so a time is never cut', async () => {
    // Arrange: the same phone with the font at its normal size, then a step up.
    const widthAt = async (fontScale: number): Promise<unknown> => {
      atFontScale(fontScale);
      await render(<TaskCard task={turnover()} />);
      return styleOf(screen.getByTestId('task-window')).width;
    };

    // Act
    const normal = await widthAt(1);
    const larger = await widthAt(1.25);

    // Assert
    expect(typeof normal).toBe('number');
    expect(larger).toBe((normal as number) * 1.25);
  });

  // The review of 05.10: grown without end, the column left the place 70 dp at
  // a doubled font — the name cut after two lines. At the largest fonts the
  // times stand above the place instead, and the place keeps the row's width.
  test('at the largest fonts the times stand above the place', async () => {
    atFontScale(2);

    await render(<TaskCard task={turnover()} onPress={jest.fn()} />);

    expect(styleOf(screen.getByTestId('task-window')).width).toBeUndefined();
    const body = screen.getByRole('button', { name: /^CZ - Nadrazni Apt 6\./ });
    expect(styleOf(body).flexDirection).toBe('column');
  });

  // The review of 05.10: one edge alone is a whole time and a dash — too long
  // for the title size in the column. It is drawn in the size of the end.
  test('a window with one edge is drawn smaller than a start', async () => {
    await render(
      <>
        <TaskCard task={task({ time_from: '10:00:00', time_to: '15:00:00' })} />
        <TaskCard task={task({ id: OTHER_ID, time_from: '10:00:00', time_to: null })} />
      </>,
    );

    const start = styleOf(screen.getByText('10:00'));
    expect(styleOf(screen.getByText('10:00–')).fontSize).toBeLessThan(start.fontSize ?? 0);
  });

  test('a row does not repeat its day: the heading of its section says it', async () => {
    await render(<TaskCard task={task()} />);

    expect(screen.queryByText(/10 ноября/)).toBeNull();
  });

  // The review of 05.10: «В работе» is a section without a day, so a cleaning
  // planned for another day and still running looked like today's. Such a row
  // says its day under the window; today's does not.
  test('work under way planned for another day says its day; today’s does not', async () => {
    await render(
      <>
        <TaskCard task={task({ scheduled_date: '2026-11-10' })} isNow />
        <TaskCard task={task({ id: OTHER_ID, scheduled_date: calendarDay(new Date()) })} isNow />
      </>,
    );

    const [earlier] = screen.getAllByTestId('task-window');
    expect(within(earlier).getByText(/10 ноября/)).toBeTruthy();
    expect(screen.queryByText('Сегодня')).toBeNull();
  });
});

describe('the quiet line', () => {
  test('shows an ordinary cleaning as one with nobody arriving', async () => {
    await render(<TaskCard task={task({ priority: 0 })} />);

    expect(screen.getByText('Заезда нет')).toBeTruthy();
  });

  test('an inspection and a midstay say what kind of job they are, not that nobody checks in', async () => {
    // Arrange / Act
    await render(<TaskCard task={task({ type: 'inspection' })} onPress={jest.fn()} />);

    // Assert: on the row and in what the reader hears.
    expect(screen.getByText('Осмотр')).toBeTruthy();
    expect(screen.queryByText('Заезда нет')).toBeNull();
    expect(screen.getByRole('button', { name: /Осмотр/ })).toBeTruthy();

    await render(<TaskCard task={task({ type: 'midstay' })} />);
    expect(screen.getByText('Уборка в проживание')).toBeTruthy();
  });

  test('stays one line, cut rather than wrapped', async () => {
    await render(<TaskCard task={task({ type: 'inspection', title: 'Проверить протечку' })} />);

    expect(screen.getByText('Проверить протечку').props.numberOfLines).toBe(1);
  });
});

describe('the marks', () => {
  test('says in words that a cleaning is under way', async () => {
    await render(<TaskCard task={task({ status: 'in_progress' })} />);

    expect(screen.getByText('В работе')).toBeTruthy();
  });

  test('says when somebody has written about the job, to the eye and to the reader', async () => {
    await render(<TaskCard task={task()} onPress={jest.fn()} hasUnread />);

    expect(screen.getByText('Новое сообщение')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Новое сообщение/ })).toBeTruthy();
  });

  test('says nothing about the conversation when there is nothing new', async () => {
    await render(<TaskCard task={task()} onPress={jest.fn()} />);

    expect(screen.queryByText('Новое сообщение')).toBeNull();
  });

  // A repair whose report the office marked high is urgent, and its card says
  // so as the task screen does: «Срочно», a pill of its own in the urgent tone
  // (docs/redesign-plan.md 2.4) — what a technician plans his day by.
  const repair = (priority: 'low' | 'normal' | 'high') =>
    task({
      type: 'maintenance',
      status: 'assigned',
      assignee_id: OTHER_ID,
      reservation_id: null,
      problem: { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', title: 'Течёт кран', priority },
    });

  test('an urgent repair carries «Срочно» as a pill in the urgent tone', async () => {
    await render(<TaskCard task={repair('high')} onPress={jest.fn()} />);

    const flag = screen.getByTestId('task-urgent');
    expect(within(flag).getByText('Срочно')).toBeTruthy();
    expect(styleOf(flag)).toMatchObject({
      backgroundColor: TONE_COLORS.light.urgent.bg,
      borderRadius: 999,
    });
    // Heard once, with the row: its quiet line already says how urgent.
    expect(screen.getByRole('button', { name: /срочность: Высокая/ })).toBeTruthy();
  });

  test.each(['normal', 'low'] as const)('a %s repair carries no such pill', async (priority) => {
    await render(<TaskCard task={repair(priority)} />);

    expect(screen.queryByText('Срочно')).toBeNull();
  });

  test('a cleaning carries no such pill', async () => {
    await render(<TaskCard task={turnover()} />);

    expect(screen.queryByTestId('task-urgent')).toBeNull();
  });
});

describe('the cleaning under way now', () => {
  const running = task({
    status: 'in_progress',
    assignee_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  });

  test('carries the «Сейчас» pill and the stripe, and the reader hears it first', async () => {
    await render(<TaskCard task={running} onPress={jest.fn()} isNow />);

    expect(screen.getByText('Сейчас')).toBeTruthy();
    // The stripe: 3 dp of the primary colour down the card's left edge.
    const card = styleOf(screen.getByTestId('task-card'));
    expect(card.borderLeftWidth).toBe(SIZE.nowStripe);
    expect(card.borderLeftColor).toBe(THEME_COLORS.light.primary);
    expect(screen.getByRole('button', { name: /^Сейчас\. CZ - Nadrazni Apt 6\./ })).toBeTruthy();
  });

  test('keeps the words of its state beside the pill: a mark is never colour alone', async () => {
    await render(<TaskCard task={running} onPress={jest.fn()} isNow />);

    expect(screen.getByText('В работе')).toBeTruthy();
    expect(screen.getByRole('button', { name: /\. В работе$/ })).toBeTruthy();
  });

  test('a row that is not the current work has neither', async () => {
    await render(<TaskCard task={task()} onPress={jest.fn()} />);

    expect(screen.queryByText('Сейчас')).toBeNull();
    expect(styleOf(screen.getByTestId('task-card')).borderLeftWidth ?? 0).toBe(0);
  });
});

describe('opening it', () => {
  test('opens the task when the row is pressed', async () => {
    const onPress = jest.fn();
    await render(<TaskCard task={task()} onPress={onPress} />);

    await fireEvent.press(screen.getByRole('button', { name: /CZ - Nadrazni Apt 6/ }));

    expect(onPress).toHaveBeenCalledWith(TASK_ID);
  });

  test('the reader hears what the row says: the place, the day and window, the check-in', async () => {
    await render(<TaskCard task={turnover()} onPress={jest.fn()} />);

    expect(
      screen.getByRole('button', {
        name: /^CZ - Nadrazni Apt 6\. Вт, 10 ноября, 10:00–15:00\. В \d{2}:\d{2} заезд$/,
      }),
    ).toBeTruthy();
  });

  test('a row is at least a list row high, for a gloved finger', async () => {
    await render(<TaskCard task={task()} onPress={jest.fn()} />);

    const row = screen.getByRole('button', { name: /^CZ - Nadrazni Apt 6\./ });
    expect(styleOf(row).minHeight).toBe(TOUCH_TARGET.phoneRow);
  });
});

describe('taking it from the queue', () => {
  test('offers no claim button in the list of tasks already assigned', async () => {
    await render(<TaskCard task={task()} />);

    expect(screen.queryByRole('button', { name: /Взять уборку/ })).toBeNull();
  });

  test('claims the task it was given when the button is pressed', async () => {
    const onClaim = jest.fn();
    await render(<TaskCard task={task()} onClaim={onClaim} />);

    await fireEvent.press(screen.getByRole('button', { name: /Взять уборку/ }));

    expect(onClaim).toHaveBeenCalledWith(TASK_ID);
  });

  test('the button names the cleaning it takes: the place, the day and the window', async () => {
    await render(<TaskCard task={task()} onClaim={jest.fn()} />);

    expect(
      screen.getByRole('button', {
        name: 'Взять уборку: CZ - Nadrazni Apt 6, Вт, 10 ноября, 10:00–15:00',
      }),
    ).toBeTruthy();
    expect(screen.getByText('Взять')).toBeTruthy();
  });

  test('is a 56 × 56 button at least, for a gloved finger (owner’s decision 5)', async () => {
    await render(<TaskCard task={task()} onClaim={jest.fn()} />);

    const button = styleOf(screen.getByRole('button', { name: /Взять уборку/ }));
    expect(button.minHeight).toBe(TOUCH_TARGET.phoneButton);
    expect(button.minWidth).toBe(TOUCH_TARGET.phoneButton);
  });

  test('says it is busy and does not fire a second claim while the first is in flight', async () => {
    const onClaim = jest.fn();
    await render(<TaskCard task={task()} onClaim={onClaim} isClaiming />);

    const button = screen.getByRole('button', { name: /Взять уборку/ });
    await fireEvent.press(button);

    expect(onClaim).not.toHaveBeenCalled();
    expect(button.props.accessibilityState).toMatchObject({ busy: true });
  });

  test('the row opens the task, and taking it stays a control of its own beside it', async () => {
    // Arrange
    const onPress = jest.fn();
    const onClaim = jest.fn();
    await render(<TaskCard task={task()} onPress={onPress} onClaim={onClaim} />);
    const row = screen.getByRole('button', { name: /^CZ - Nadrazni Apt 6\./ });

    // Assert: a screen reader reads a button as one element, so a button
    // inside it is out of reach on iOS — "take" must not sit inside the row's.
    expect(within(row).queryByRole('button', { name: /Взять уборку/ })).toBeNull();

    // Act / Assert: each does its own thing and not the other's.
    await fireEvent.press(screen.getByRole('button', { name: /Взять уборку/ }));
    expect(onClaim).toHaveBeenCalledWith(TASK_ID);
    expect(onPress).not.toHaveBeenCalled();

    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledWith(TASK_ID);
  });
});

describe('accepting from her list', () => {
  const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const mine = task({ status: 'assigned', assignee_id: ME });

  test('offers to accept an assigned cleaning, as a control of its own', async () => {
    // Arrange
    const onPress = jest.fn();
    const onAccept = jest.fn();
    await render(<TaskCard task={mine} onPress={onPress} onAccept={onAccept} />);
    const row = screen.getByRole('button', { name: /^CZ - Nadrazni Apt 6\./ });

    // Assert: like "take", never inside the row's own button.
    expect(within(row).queryByRole('button', { name: /^Принять/ })).toBeNull();

    // Act / Assert
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Принять: CZ - Nadrazni Apt 6, Вт, 10 ноября, 10:00–15:00',
      }),
    );
    expect(onAccept).toHaveBeenCalledWith(mine);
    expect(onPress).not.toHaveBeenCalled();
  });

  test('is a 56 × 56 button at least, like «Взять»', async () => {
    await render(<TaskCard task={mine} onAccept={jest.fn()} />);

    const button = styleOf(screen.getByRole('button', { name: /^Принять/ }));
    expect(button.minHeight).toBe(TOUCH_TARGET.phoneButton);
    expect(button.minWidth).toBe(TOUCH_TARGET.phoneButton);
  });

  test('an accepted cleaning says so, to the eye and to the reader, and is not offered again', async () => {
    await render(
      <TaskCard task={{ ...mine, status: 'accepted' }} onPress={jest.fn()} onAccept={jest.fn()} />,
    );

    expect(screen.getByText('Принята')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Принята/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Принять/ })).toBeNull();
  });

  test('says it is busy and does not fire a second accept while the first is in flight', async () => {
    const onAccept = jest.fn();
    await render(<TaskCard task={mine} onAccept={onAccept} isAccepting />);

    const button = screen.getByRole('button', { name: /^Принять/ });
    await fireEvent.press(button);

    expect(onAccept).not.toHaveBeenCalled();
    expect(button.props.accessibilityState).toMatchObject({ busy: true });
  });

  test('free work is taken, not accepted, and work under way is past accepting', async () => {
    await render(<TaskCard task={task()} onAccept={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /^Принять/ })).toBeNull();

    await render(<TaskCard task={{ ...mine, status: 'in_progress' }} onAccept={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /^Принять/ })).toBeNull();
  });
});
