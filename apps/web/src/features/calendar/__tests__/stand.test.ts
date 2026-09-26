import { describe, expect, test } from 'vitest';

import { todayIso } from '@/lib/format-date';

import { fetchExpiredBetween, fetchLiveRepairs, fetchTasksBetween } from '@/features/tasks/api';
import { overdueRepairsByProperty } from '@/features/tasks/repairs';

import { fetchCalendarBookings } from '../api';
import { collapseExpired } from '../chips';
import { addDays } from '../dates';
import { standClient } from '../stand';

/**
 * The stand answers the real reader (docs/f10-plan.md, §5): pages, the count,
 * zod on the way in. If the stub drifted from what the reader asks, the stand
 * would measure an empty calendar.
 */
describe('the stand’s tasks', () => {
  test('answer the calendar’s reader, with every case 7.4 is checked on', async () => {
    const today = todayIso();

    const rows = await fetchTasksBetween(
      standClient(),
      addDays(today, -5),
      addDays(today, 15),
      'active',
    );

    expect(rows.length).toBeGreaterThan(500);
    expect(rows.some((row) => row.problem !== null)).toBe(true);
    expect(rows.some((row) => row.reservation_id === 999999)).toBe(true);
    expect(rows.some((row) => row.priority === 1)).toBe(true);
    expect(rows.some((row) => row.status === 'done')).toBe(true);
  });

  // A block and the office's own "#" booking owe no cleaning (§5).
  test('put no cleaning on a block or a "#" booking', async () => {
    const today = todayIso();
    const client = standClient();
    const [bookings, tasks] = await Promise.all([
      fetchCalendarBookings(client, addDays(today, -5), addDays(today, 15)),
      fetchTasksBetween(client, addDays(today, -5), addDays(today, 15), 'active'),
    ]);
    const blocks = new Set(
      bookings
        .filter((one) => one.status === 'ownerStay' || one.is_service_booking)
        .map((one) => one.id),
    );

    expect(blocks.size).toBeGreaterThan(0);
    expect(
      tasks.filter((task) => task.reservation_id !== null && blocks.has(task.reservation_id)),
    ).toEqual([]);
  });
});

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

describe('the stand for 7.5', () => {
  test('has what never happened in copies, folded to one mark per key', async () => {
    const today = todayIso();

    const rows = await fetchExpiredBetween(standClient(), addDays(today, -30), today);

    expect(rows.length).toBeGreaterThan(collapseExpired(rows).length);
    expect(rows.every((row) => row.scheduled_date < today)).toBe(true);
  });

  test('has three repairs left behind, one with a technician who left, one on a room', async () => {
    const repairs = await fetchLiveRepairs(standClient());
    const alerts = overdueRepairsByProperty(repairs);

    expect(alerts.size).toBe(3);
    expect([...alerts.values()].filter((alert) => alert.isTechnicianOff)).toHaveLength(1);
    expect(alerts.has(2011)).toBe(true);
  });
});
