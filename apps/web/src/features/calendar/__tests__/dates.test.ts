import { describe, expect, test } from 'vitest';

import {
  addDays,
  defaultStart,
  isDepth,
  monthBounds,
  monthsOf,
  neighbourMonths,
  windowDays,
} from '../dates';

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
    expect(defaultStart('2026-09-26')).toBe('2026-09-25');
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
