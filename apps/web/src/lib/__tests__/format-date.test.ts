import { describe, expect, test } from 'vitest';

import { formatDateTime, formatDay, todayIso } from '../format-date';

describe('formatDay', () => {
  test('reads a database day as a calendar day in the manager language', () => {
    expect(formatDay('2026-09-10', 'en')).toBe('10 Sept 2026');
    expect(formatDay('2026-09-10', 'ru')).toContain('2026');
  });
});

describe('formatDateTime', () => {
  test('shows date and time in the manager language', () => {
    expect(formatDateTime('2026-09-10T09:05:00+00:00', 'en')).toMatch(/10 Sept 2026, \d{2}:\d{2}/);
  });
});

describe('todayIso', () => {
  test('pads month and day', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
