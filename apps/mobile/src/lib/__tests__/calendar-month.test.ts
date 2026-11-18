import {
  daysBetween,
  daysInMonth,
  firstDayOf,
  isMonth,
  monthOf,
  monthWeeks,
  shiftDay,
  shiftMonth,
  todayDay,
} from '../calendar-month';

/**
 * The calendar's arithmetic: months as `YYYY-MM`, days as `YYYY-MM-DD`, on the
 * phone's own calendar — never an instant read at midnight UTC.
 */

describe('monthWeeks', () => {
  test('November 2026 starts on a Sunday: six weeks, Monday first', () => {
    const weeks = monthWeeks('2026-11');

    expect(weeks).toHaveLength(6);
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[1][0]).toBe('2026-11-02');
    expect(weeks[5]).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  test('February 2021 starts on a Monday and fills exactly four weeks', () => {
    const weeks = monthWeeks('2021-02');

    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toBe('2021-02-01');
    expect(weeks[3][6]).toBe('2021-02-28');
  });

  test('every day of the month is there once, in order', () => {
    const days = monthWeeks('2028-02').flat().filter((day) => day !== null);

    expect(days).toHaveLength(29);
    expect(days[0]).toBe('2028-02-01');
    expect(days.at(-1)).toBe('2028-02-29');
  });
});

describe('moving through the calendar', () => {
  test('a month after December is January of the next year, and back', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
  });

  test('a day after the end of a month is the first of the next', () => {
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('whole days between two days, a change of the clocks counting for nothing', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-11-01', '2027-01-01')).toBe(61);
  });

  test('the month of a day, its first day and its length', () => {
    expect(monthOf('2026-11-18')).toBe('2026-11');
    expect(firstDayOf('2026-11')).toBe('2026-11-01');
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
  });

  test('today is the phone’s calendar date', () => {
    expect(todayDay(new Date(2026, 10, 18, 23, 59))).toBe('2026-11-18');
  });
});

test('anything that is not a month or a day is refused, not guessed', () => {
  expect(isMonth('2026-11')).toBe(true);
  expect(isMonth('2026-11-01')).toBe(false);
  expect(() => monthWeeks('11/2026')).toThrow(RangeError);
  expect(() => shiftDay('2026-11', 1)).toThrow(RangeError);
});
