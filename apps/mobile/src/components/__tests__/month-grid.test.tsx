import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { MonthGrid, type DayMark } from '../month-grid';

/**
 * The month grid: a button per day, Monday first, the picked one selected,
 * today framed, a count under a day and a dot for attention — each said to
 * the reader in words, never by colour alone. The arrows ask for the month
 * before and after; the grid keeps nothing of its own.
 */

const MARKS: Readonly<Record<string, DayMark>> = {
  '2026-11-18': { count: 3, isAttention: true },
  '2026-11-20': { count: 1 },
};

function markLabel(mark: DayMark): string {
  return [`уборок: ${mark.count}`, mark.isAttention === true ? 'кто-то ждёт' : null]
    .filter((part) => part !== null)
    .join(', ');
}

async function show(overrides: Partial<Parameters<typeof MonthGrid>[0]> = {}) {
  const onSelectDay = jest.fn();
  const onMonthChange = jest.fn();
  await render(
    <MonthGrid
      month="2026-11"
      selectedDay="2026-11-18"
      marks={MARKS}
      today="2026-11-18"
      markLabel={markLabel}
      onSelectDay={onSelectDay}
      onMonthChange={onMonthChange}
      {...overrides}
    />,
  );
  return { onSelectDay, onMonthChange };
}

function day(date: string) {
  return screen.getByTestId(`month-grid-day-${date}`);
}

test('the month is its heading, and every day of it is a button', async () => {
  await show();

  expect(screen.getByRole('header').props.children).toBe('Ноябрь 2026');
  // Thirty days and the two arrows.
  expect(screen.getAllByRole('button')).toHaveLength(32);
});

test('a day is heard by its full date, «сегодня» on today, and its mark in the caller’s words', async () => {
  await show();

  const label = day('2026-11-18').props.accessibilityLabel as string;
  expect(label).toContain('18 ноября');
  expect(label).toContain('сегодня');
  expect(label).toContain('уборок: 3, кто-то ждёт');
  expect(day('2026-11-19').props.accessibilityLabel).not.toContain('сегодня');
});

test('the picked day is selected; the others are not', async () => {
  await show({ selectedDay: '2026-11-20' });

  expect(day('2026-11-20').props.accessibilityState).toMatchObject({ selected: true });
  expect(day('2026-11-18').props.accessibilityState).toMatchObject({ selected: false });
});

test('a count is drawn under its day, and attention as a dot of its own', async () => {
  await show();

  expect(within(day('2026-11-18')).getByText('3')).toBeTruthy();
  expect(within(day('2026-11-20')).getByText('1')).toBeTruthy();
  expect(within(day('2026-11-19')).queryByText('1')).toBeNull();
  expect(screen.getByTestId('month-grid-attention-2026-11-18')).toBeTruthy();
  expect(screen.queryByTestId('month-grid-attention-2026-11-20')).toBeNull();
});

test('a day pressed is handed to the caller', async () => {
  const { onSelectDay } = await show();

  await fireEvent.press(day('2026-11-20'));

  expect(onSelectDay).toHaveBeenCalledWith('2026-11-20');
});

test('the arrows ask for the month before and the month after', async () => {
  const { onMonthChange } = await show();

  await fireEvent.press(screen.getByRole('button', { name: 'Следующий месяц' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Предыдущий месяц' }));

  expect(onMonthChange.mock.calls).toEqual([['2026-12'], ['2026-10']]);
});

test('without marks or a label a day says its date only', async () => {
  await show({ marks: undefined, markLabel: undefined, today: '2026-12-01' });

  expect(day('2026-11-18').props.accessibilityLabel).toMatch(/^[^,]+, 18 ноября$/);
});
