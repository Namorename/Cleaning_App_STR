import { describe, expect, it } from 'vitest';

import {
  MAX_PERIOD_DAYS,
  isValidPeriod,
  periodDays,
  presetPeriod,
  previousPeriod,
} from '../period';

describe('presetPeriod', () => {
  const today = '2026-10-15';

  it('counts the last 7, 30 and 90 days back from today, today included', () => {
    expect(presetPeriod('7d', today)).toEqual({ from: '2026-10-09', to: '2026-10-15' });
    expect(presetPeriod('30d', today)).toEqual({ from: '2026-09-16', to: '2026-10-15' });
    expect(presetPeriod('90d', today)).toEqual({ from: '2026-07-18', to: '2026-10-15' });
  });

  it('takes this month up to today and the whole of last month', () => {
    expect(presetPeriod('thisMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-15' });
    expect(presetPeriod('lastMonth', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('crosses a year for last month in January', () => {
    expect(presetPeriod('lastMonth', '2027-01-03')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('previousPeriod', () => {
  it('compares a whole month with the whole month before', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('compares this month so far with the same days of the month before', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-15' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-15',
    });
    // The 31st has no twin in September: the month before ends on its last day.
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-31' }).to).toBe('2026-09-30');
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-30' })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('compares any other period with as many days right before it', () => {
    expect(previousPeriod({ from: '2026-10-09', to: '2026-10-15' })).toEqual({
      from: '2026-10-02',
      to: '2026-10-08',
    });
    expect(previousPeriod({ from: '2026-10-15', to: '2026-10-15' })).toEqual({
      from: '2026-10-14',
      to: '2026-10-14',
    });
  });
});

describe('periodDays and isValidPeriod', () => {
  it('counts both ends', () => {
    expect(periodDays({ from: '2026-10-01', to: '2026-10-31' })).toBe(31);
    expect(periodDays({ from: '2026-10-15', to: '2026-10-15' })).toBe(1);
  });

  it('accepts a forward period of at most the server limit', () => {
    expect(MAX_PERIOD_DAYS).toBe(400);
    expect(isValidPeriod({ from: '2026-01-01', to: '2026-12-31' })).toBe(true);
    expect(isValidPeriod({ from: '2026-10-16', to: '2026-10-15' })).toBe(false);
    expect(isValidPeriod({ from: '2025-01-01', to: '2026-12-31' })).toBe(false);
    expect(isValidPeriod({ from: 'not a day', to: '2026-12-31' })).toBe(false);
  });
});
