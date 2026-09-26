import { describe, expect, test } from 'vitest';

import { todayIso } from '@/lib/format-date';

import {
  fetchExpiredBetween,
  fetchLiveRepairs,
  fetchProperties,
  fetchTasksBetween,
} from '@/features/tasks/api';
import { overdueRepairsByProperty } from '@/features/tasks/repairs';

import { fetchCalendarBookings } from '../api';
import { collapseExpired } from '../chips';
import { addDays } from '../dates';
import { STAND_ANSWER_MARK, STAND_WORK_MEASURE, standClient } from '../stand';

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

// 7.6 (docs/f10-plan.md, §5): the matrix is measured at ×1 and ×3, and the
// time to «data ready» is read off the stand's own answers.
describe('the stand for 7.6', () => {
  test('at ×3 holds three copies of every row, stay and task, no two sharing an id', async () => {
    const today = todayIso();
    const from = addDays(today, -5);
    const to = addDays(today, 15);
    const [one, three] = [standClient(), standClient(3)];

    const [rows1, rows3, stays1, stays3, tasks1, tasks3] = await Promise.all([
      fetchProperties(one),
      fetchProperties(three),
      fetchCalendarBookings(one, from, to),
      fetchCalendarBookings(three, from, to),
      fetchTasksBetween(one, from, to, 'active'),
      fetchTasksBetween(three, from, to, 'active'),
    ]);

    expect(rows3).toHaveLength(rows1.length * 3);
    expect(stays3).toHaveLength(stays1.length * 3);
    expect(tasks3).toHaveLength(tasks1.length * 3);
    for (const list of [rows3, stays3, tasks3]) {
      expect(new Set(list.map((item) => item.id)).size).toBe(list.length);
    }
    // A copy's room still hangs under its copy's listing.
    const byId = new Map(rows3.map((row) => [row.id, row]));
    expect(rows3.every((row) => row.parent_id === null || byId.has(row.parent_id))).toBe(true);
  });

  test('marks every answer, so «data ready» is the last one before the paint', async () => {
    performance.clearMarks(STAND_ANSWER_MARK);

    await fetchProperties(standClient());

    expect(performance.getEntriesByName(STAND_ANSWER_MARK).length).toBeGreaterThan(0);
  });

  // The stub filters and sorts in the browser, which a real client never
  // does: its own time is measured apart, to be taken off «painted».
  test('measures its own work apart from the calendar', async () => {
    performance.clearMeasures(STAND_WORK_MEASURE);

    await fetchProperties(standClient());

    expect(performance.getEntriesByName(STAND_WORK_MEASURE, 'measure').length).toBeGreaterThan(1);
  });
});
