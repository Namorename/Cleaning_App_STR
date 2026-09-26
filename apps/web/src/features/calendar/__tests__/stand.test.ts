import { describe, expect, test } from 'vitest';

import { todayIso } from '@/lib/format-date';

import { fetchCalendarBookings } from '../api';
import { addDays } from '../dates';
import { standClient } from '../stand';

/**
 * The stand answers the real reader (docs/f10-plan.md, §5): pages, the count,
 * zod on the way in. If the stub drifted from what the reader asks, the stand
 * would measure an empty calendar.
 */
describe('the stand', () => {
  test('answers the bookings reader page by page, with every case 7.3 is checked on', async () => {
    const today = todayIso();

    const rows = await fetchCalendarBookings(standClient(), addDays(today, -5), addDays(today, 15));

    expect(rows.length).toBeGreaterThan(500);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.some((row) => row.is_service_booking)).toBe(true);
    expect(rows.some((row) => row.status === 'ownerStay')).toBe(true);
    expect(rows.some((row) => row.rooms.length === 2)).toBe(true);
    expect(
      rows.some(
        (row) => row.departure_date > addDays(today, 30) && row.arrival_date < addDays(today, -1),
      ),
    ).toBe(true);
  });
});
