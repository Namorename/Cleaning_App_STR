import { jobTail, localDay, OVERDUE_AFTER_DAYS, todayInZone } from '@str-ops/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * The day rule both apps count by (packages/shared, schedule/job-tail.ts):
 * the panel's «Уборки» and «Задания» and the head technician's board on the
 * phone. Run here because the shared package has no runner of its own.
 */
describe('the line between hanging and overdue (owner, 2026-11-05)', () => {
  test('is three days', () => {
    expect(OVERDUE_AFTER_DAYS).toBe(3);
  });

  test('a job on today or later hangs nowhere', () => {
    expect(jobTail('2026-11-05', '2026-11-05')).toBeNull();
    expect(jobTail('2026-11-06', '2026-11-05')).toBeNull();
  });

  test.each([
    ['2026-11-04', 1, false],
    ['2026-11-03', 2, false],
    ['2026-11-02', 3, true],
    ['2026-10-25', 11, true],
  ])('a job on %s hangs %i days, overdue: %s', (day, days, isOverdue) => {
    expect(jobTail(day, '2026-11-05')).toEqual({ days, isOverdue });
  });

  test('counts calendar days across a month and a clock change', () => {
    // 25.10 is the night Central Europe leaves summer time.
    expect(jobTail('2026-10-24', '2026-10-27')).toEqual({ days: 3, isOverdue: true });
    expect(jobTail('2026-02-27', '2026-03-01')).toEqual({ days: 2, isOverdue: false });
  });
});

describe("a listing's today", () => {
  afterEach(() => vi.restoreAllMocks());

  // 22:30 UTC on 23.09 is already 00:30 on 24.09 in Prague (summer time).
  const lateEvening = new Date('2026-09-23T22:30:00Z');

  test("is the listing's own calendar day, not the device's", () => {
    expect(todayInZone('Europe/Prague', lateEvening)).toBe('2026-09-24');
    expect(todayInZone('UTC', lateEvening)).toBe('2026-09-23');
  });

  test("is the device's day with no zone, or one the engine does not know", () => {
    expect(todayInZone(null, lateEvening)).toBe(localDay(lateEvening));
    expect(todayInZone(undefined, lateEvening)).toBe(localDay(lateEvening));
    expect(todayInZone('Mars/Olympus_Mons', lateEvening)).toBe(localDay(lateEvening));
  });

  test("is the device's day where the engine answers no date parts", () => {
    // A phone whose Intl lacks formatToParts, or answers parts with no date.
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([]);

    expect(todayInZone('Asia/Tokyo', lateEvening)).toBe(localDay(lateEvening));
  });
});
