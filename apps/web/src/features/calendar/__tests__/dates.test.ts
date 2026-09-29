import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  addDays,
  dayLabel,
  dayWidthFor,
  defaultStart,
  fullDayLabel,
  isDepth,
  monthBounds,
  monthsOf,
  neighbourMonths,
  windowDays,
} from '../dates';

// The header labels every column on every redraw of the grid (ROADMAP, 7.6 tail).
describe('the column labels build their formats once', () => {
  afterEach(() => vi.restoreAllMocks());

  test('for a month of columns in the same locale', () => {
    const built = vi.spyOn(Intl, 'DateTimeFormat');
    for (const day of windowDays('2026-10-01', 30)) {
      dayLabel(day, 'ru-RU', 30);
      fullDayLabel(day, 'ru-RU');
    }
    expect(built.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('the days of the window', () => {
  test('a day steps over the end of a month and of a year', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('a window is as many days as its depth, one after another', () => {
    const days = windowDays('2026-09-25', 7);

    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-09-25');
    expect(days[6]).toBe('2026-10-01');
  });

  // The window opens a day before today: yesterday's late check-out is still
  // on the manager's mind (docs/f10-plan.md, 7.2).
  test('opens the day before today', () => {
    expect(defaultStart('2026-09-26', 7)).toBe('2026-09-25');
  });

  // Data is keyed by calendar month; a 30-day window from 31 January of a
  // common year touches three of them.
  test('names every month the window touches', () => {
    expect(monthsOf(windowDays('2027-01-31', 30))).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(monthsOf(windowDays('2026-09-25', 3))).toEqual(['2026-09']);
  });

  // A month is read as a half-open range of days: from its first day to the
  // first day of the next.
  test('a month is its first day up to the first day of the next', () => {
    expect(monthBounds('2026-09')).toEqual({ from: '2026-09-01', to: '2026-10-01' });
    expect(monthBounds('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });

  // The arrows reach the neighbours next, so their bookings are read ahead.
  test('the neighbours of the window are the month before and the month after', () => {
    expect(neighbourMonths(['2026-09', '2026-10'])).toEqual(['2026-08', '2026-11']);
    expect(neighbourMonths(['2027-01'])).toEqual(['2026-12', '2027-02']);
    expect(neighbourMonths([])).toEqual([]);
  });
});

describe('isDepth', () => {
  test('only the depths the controls offer', () => {
    expect(isDepth(7)).toBe(true);
    expect(isDepth(30)).toBe(true);
    expect(isDepth(10)).toBe(false);
    expect(isDepth('7')).toBe(false);
  });
});

// The owner's request of 2026-09-27: the days fill the area; the width by
// depth is the least a column gets, and below it the grid scrolls sideways.
describe('the width of a day', () => {
  test('stretches so the days fill the area', () => {
    expect(dayWidthFor(15, 1040)).toBe(69);
    expect(dayWidthFor(7, 1040)).toBe(148);
    expect(dayWidthFor(30, 1040)).toBe(34);
  });

  test('never falls below the least a column of that depth needs', () => {
    expect(dayWidthFor(15, 700)).toBe(64);
    expect(dayWidthFor(7, 500)).toBe(130);
  });

  test('is the least width while the area is not measured yet', () => {
    expect(dayWidthFor(30, 0)).toBe(32);
    expect(dayWidthFor(30, -240)).toBe(32);
  });
});

// The branch preflight of 2026-09-27: at one day the window was yesterday,
// and «Сегодня» went back to yesterday.
describe('where the window opens', () => {
  test("a day before today, so yesterday's departures still show", () => {
    expect(defaultStart('2026-09-26', 7)).toBe('2026-09-25');
    expect(defaultStart('2026-09-26', 3)).toBe('2026-09-25');
  });

  test('on today itself when the window is one day', () => {
    expect(defaultStart('2026-09-26', 1)).toBe('2026-09-26');
  });
});
