import { describe, expect, test } from 'vitest';

import { addDays, DEPTHS, openingWindow, windowDays } from '@/features/calendar/dates';
import {
  calendarTaskSchema,
  liveRepairSchema,
  offStaffTaskSchema,
  type CalendarTask,
  type LiveRepair,
  type OffStaffTask,
} from '@/features/tasks/schema';

import {
  cleaningsToday,
  dashboardWindow,
  newSupplyCount,
  offStaffWork,
  openProblemCount,
  repairCounts,
  stuckRepairs,
  UNASSIGNED_DAYS,
  unassignedAhead,
} from '../counts';

/** The listings the calendar draws a row for: the fixture's one. */
const DRAWN: ReadonlySet<number> = new Set([1]);

// Noon in Prague: every listing of the fixture is on 2026-09-30.
const NOW = new Date('2026-09-30T10:00:00Z');
// Half past midnight in Prague, still the evening before in New York.
const PRAGUE_MIDNIGHT = new Date('2026-09-30T22:30:00Z');

const ANNA = '11111111-1111-4111-8111-111111111111';
const PRAGUE = { name: 'Anglicka 7', timezone: 'Europe/Prague' };
const NEW_YORK = { name: 'Brooklyn 5', timezone: 'America/New_York' };

let serial = 0;
const uuid = (prefix: string) => {
  serial += 1;
  return `${prefix}-0000-4000-8000-${String(serial).padStart(12, '0')}`;
};

const task = (day: string, extra: Record<string, unknown> = {}): CalendarTask =>
  calendarTaskSchema.parse({
    id: uuid('00000000'),
    property_id: 1,
    reservation_id: null,
    problem_id: null,
    type: 'cleaning',
    status: 'assigned',
    priority: 0,
    assignee_id: ANNA,
    scheduled_date: day,
    time_from: null,
    time_to: null,
    started_at: null,
    completed_at: null,
    measured_minutes: null,
    duration_override_min: null,
    notes: null,
    created_at: '2026-09-20T08:00:00+00:00',
    property: PRAGUE,
    assignee: null,
    problem: null,
    ...extra,
  });

/** Nobody holds it: the status the server gives a task without an executor. */
const free = (day: string, extra: Record<string, unknown> = {}) =>
  task(day, { status: 'unassigned', assignee_id: null, ...extra });

const repair = (day: string, extra: Record<string, unknown> = {}): LiveRepair =>
  liveRepairSchema.parse({
    id: uuid('aaaaaaaa'),
    property_id: 1,
    problem_id: uuid('bbbbbbbb'),
    status: 'assigned',
    scheduled_date: day,
    assignee_id: ANNA,
    assignee: { full_name: 'Anna', is_active: true },
    property: { name: 'Anglicka 7', status: 'active', timezone: 'Europe/Prague' },
    ...extra,
  });

/** Started by somebody who has since been switched off: what the switch did not take. */
const offTask = (day: string, extra: Record<string, unknown> = {}): OffStaffTask =>
  offStaffTaskSchema.parse({
    id: uuid('cccccccc'),
    property_id: 1,
    type: 'cleaning',
    status: 'in_progress',
    scheduled_date: day,
    assignee_id: ANNA,
    assignee: { full_name: 'Anna', is_active: false },
    property: { name: 'Anglicka 7', status: 'active', timezone: 'Europe/Prague' },
    ...extra,
  });

describe('dashboardWindow', () => {
  test('reads a day either side of the week, so a listing in another zone keeps its days', () => {
    expect(dashboardWindow(NOW)).toEqual({ from: '2026-09-29', to: '2026-10-08' });
  });
});

describe('cleaningsToday', () => {
  test('counts the cleanings and mid-stay cleanings of today, and how many are done', () => {
    const tasks = [
      task('2026-09-30'),
      task('2026-09-30', { type: 'midstay', status: 'in_progress' }),
      task('2026-09-30', { status: 'done' }),
    ];

    expect(cleaningsToday(tasks, NOW)).toEqual({ total: 3, done: 1 });
  });

  test('leaves out other kinds, other days, the cancelled and the expired', () => {
    const tasks = [
      task('2026-09-30', { type: 'maintenance' }),
      task('2026-09-30', { type: 'inspection' }),
      task('2026-10-01'),
      task('2026-09-29', { status: 'in_progress' }),
      task('2026-09-30', { status: 'cancelled' }),
      task('2026-09-30', { status: 'expired' }),
    ];

    expect(cleaningsToday(tasks, NOW)).toEqual({ total: 0, done: 0 });
  });

  test('today is the listing’s own day', () => {
    const tasks = [
      task('2026-10-01'),
      task('2026-09-30', { property: NEW_YORK }),
      task('2026-09-30'),
    ];

    expect(cleaningsToday(tasks, PRAGUE_MIDNIGHT)).toEqual({ total: 2, done: 0 });
  });
});

describe('unassignedAhead', () => {
  test('counts the live tasks of every kind nobody holds, from today through the sixth day on', () => {
    const tasks = [
      free('2026-09-30'),
      free('2026-09-30', { type: 'inspection' }),
      free('2026-10-01', { type: 'maintenance' }),
      free('2026-10-04', { type: 'midstay' }),
      free('2026-10-06'),
    ];

    expect(unassignedAhead(tasks, DRAWN, NOW)).toEqual({ week: 5, today: 2, tomorrow: 1 });
  });

  test('leaves out what somebody holds, what is closed, and what lies outside the week', () => {
    const tasks = [
      task('2026-09-30'),
      free('2026-09-30', { status: 'done' }),
      free('2026-09-30', { status: 'cancelled' }),
      free('2026-09-30', { status: 'expired' }),
      free('2026-09-29'),
      free('2026-10-07'),
    ];

    expect(unassignedAhead(tasks, DRAWN, NOW)).toEqual({ week: 0, today: 0, tomorrow: 0 });
  });

  test('counts by the listing’s own day', () => {
    const tasks = [
      free('2026-10-01'),
      free('2026-09-30', { property: NEW_YORK }),
      free('2026-09-30'),
    ];

    expect(unassignedAhead(tasks, DRAWN, PRAGUE_MIDNIGHT)).toEqual({
      week: 2,
      today: 2,
      tomorrow: 0,
    });
  });

  // The tile leads to the calendar, which draws no row for an archived listing:
  // an inspection or a repair there stays live after the archive (20260924170000).
  test('counts only what the calendar has a row for', () => {
    const tasks = [free('2026-09-30'), free('2026-10-01', { property_id: 2, type: 'inspection' })];

    expect(unassignedAhead(tasks, DRAWN, NOW)).toEqual({ week: 1, today: 1, tomorrow: 0 });
  });
});

// The tile's week has to be on the screen its link opens (dashboard preflight):
// the calendar usually opens on yesterday at the depth the manager last chose.
describe('the calendar the «Без исполнителя» tile opens', () => {
  test.each(DEPTHS)('shows every day the tile counts, from a stored depth of %i', (stored) => {
    const today = '2026-09-30';

    const { start, depth } = openingWindow(today, stored, UNASSIGNED_DAYS);
    const shown = windowDays(start, depth);

    expect(shown[0]).toBe(today);
    for (let ahead = 0; ahead < UNASSIGNED_DAYS; ahead += 1) {
      expect(shown).toContain(addDays(today, ahead));
    }
  });
});

describe('openProblemCount', () => {
  test('counts what is neither closed nor archived', () => {
    const problems = [
      { status: 'open', archived_at: null },
      { status: 'assigned', archived_at: null },
      { status: 'in_progress', archived_at: null },
      { status: 'resolved', archived_at: null },
      { status: 'cancelled', archived_at: null },
      { status: 'open', archived_at: '2026-09-29T08:00:00+00:00' },
    ] as const;

    expect(openProblemCount(problems)).toBe(3);
  });
});

describe('newSupplyCount', () => {
  test('counts the requests of the «Новые» tab', () => {
    const requests = [
      { status: 'new' },
      { status: 'new' },
      { status: 'accepted' },
      { status: 'ordered' },
      { status: 'fulfilled' },
      { status: 'rejected' },
    ] as const;

    expect(newSupplyCount(requests)).toBe(2);
  });
});

describe('stuckRepairs', () => {
  test('keeps a repair past its day and one whose technician left, oldest first', () => {
    const late = repair('2026-09-28');
    const leftAhead = repair('2026-10-05', { assignee: { full_name: 'Iva', is_active: false } });
    const both = repair('2026-09-20', { assignee: { full_name: 'Iva', is_active: false } });
    const fine = repair('2026-10-02');
    const nobodyAhead = repair('2026-10-03', { assignee_id: null, assignee: null });

    const stuck = stuckRepairs([late, leftAhead, both, fine, nobodyAhead], NOW);

    expect(stuck.map((one) => one.repair.id)).toEqual([both.id, late.id, leftAhead.id]);
    expect(stuck.map(({ isOverdue, isTechnicianOff }) => [isOverdue, isTechnicianOff])).toEqual([
      [true, true],
      [true, false],
      [false, true],
    ]);
  });

  test('a repair nobody holds is stuck once overdue; nobody on it is not a technician who left', () => {
    const stuck = stuckRepairs([repair('2026-09-25', { assignee_id: null, assignee: null })], NOW);

    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toMatchObject({ isOverdue: true, isTechnicianOff: false });
  });

  test('a repair of today is not overdue yet', () => {
    expect(stuckRepairs([repair('2026-09-30')], NOW)).toEqual([]);
  });
});

describe('repairCounts', () => {
  test('counts each of the two signals; one repair can be in both', () => {
    const stuck = stuckRepairs(
      [
        repair('2026-09-28'),
        repair('2026-10-05', { assignee: { full_name: 'Iva', is_active: false } }),
        repair('2026-09-20', { assignee: { full_name: 'Iva', is_active: false } }),
      ],
      NOW,
    );

    expect(repairCounts(stuck)).toEqual({ overdue: 2, technicianOff: 2 });
  });
});

describe('offStaffWork', () => {
  // Switching an account off takes it off everything nobody has started
  // (20261004100000); what was started stays on it for the manager to decide.
  test('is the work under way of people switched off, oldest first, by id within a day', () => {
    const late = offTask('2026-09-29');
    const early = offTask('2026-09-20', { status: 'paused', type: 'inspection' });
    const blocked = offTask('2026-09-29', { status: 'blocked', type: 'maintenance' });
    const working = offTask('2026-09-25', { assignee: { full_name: 'Iva', is_active: true } });
    const notStarted = offTask('2026-09-26', { status: 'assigned' });
    const done = offTask('2026-09-27', { status: 'done' });

    expect(offStaffWork([late, working, early, notStarted, done, blocked])).toEqual([
      early,
      late,
      blocked,
    ]);
  });

  test('is empty when nobody switched off has started anything', () => {
    expect(offStaffWork([])).toEqual([]);
  });
});
