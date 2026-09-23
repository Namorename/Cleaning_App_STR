import { describe, expect, test } from 'vitest';

import { formatDateTime, formatDay, formatShortDay, todayIn, todayIso } from '../format-date';

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

describe('todayIn', () => {
  // 22:30 UTC on 23.09 is already 00:30 on 24.09 in Prague (summer time).
  const lateEvening = new Date('2026-09-23T22:30:00Z');

  test("is the property's own calendar day, not the browser's", () => {
    expect(todayIn('Europe/Prague', lateEvening)).toBe('2026-09-24');
    expect(todayIn('UTC', lateEvening)).toBe('2026-09-23');
  });

  test("falls back to the browser's day when the zone is missing or unknown", () => {
    expect(todayIn(null, lateEvening)).toBe(todayIso(lateEvening));
    expect(todayIn(undefined, lateEvening)).toBe(todayIso(lateEvening));
    expect(todayIn('Mars/Olympus_Mons', lateEvening)).toBe(todayIso(lateEvening));
  });
});

describe('formatShortDay', () => {
  test('is day and month only, the way a label on a card wants it', () => {
    expect(formatShortDay('2026-09-22', 'ru')).toBe('22.09');
    expect(formatShortDay('2026-09-22', 'en')).toBe('22/09');
  });
});
