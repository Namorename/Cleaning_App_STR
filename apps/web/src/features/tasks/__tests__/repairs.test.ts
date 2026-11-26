import { describe, expect, test } from 'vitest';

import {
  isRepairOverdue,
  isTechnicianOff,
  overdueRepairsByProperty,
  repairTailDay,
  repairTailOf,
} from '../repairs';
import { liveRepairSchema, type LiveRepair } from '../schema';

/**
 * The one rule of a repair left behind (docs/f10-plan.md, §6): the calendar's
 * badge and stage 8's dashboard count by it, so it has no second copy.
 */

const TECHNICIAN = '11111111-1111-4111-8111-111111111111';
const IVA = '22222222-2222-4222-8222-222222222222';

let serial = 0;
function repair(extra: Record<string, unknown> = {}): LiveRepair {
  serial += 1;
  return liveRepairSchema.parse({
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
    property_id: 1,
    problem_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'assigned',
    scheduled_date: '2026-09-20',
    assignee_id: '11111111-1111-4111-8111-111111111111',
    assignee: { full_name: 'Technician 1', is_active: true },
    property: { name: 'Anglicka 7', status: 'active', timezone: 'Europe/Prague' },
    ...extra,
  });
}

describe('a repair is overdue', () => {
  // 23:30 in London on the 26th is already the 27th in Prague.
  const lateEvening = new Date('2026-09-26T23:30:00Z');

  // Three days behind in Prague (the 27th), two in UTC (the 26th).
  test('from the third day past its day, counted by the listing’s own today', () => {
    expect(isRepairOverdue(repair({ scheduled_date: '2026-09-24' }), lateEvening)).toBe(true);
    expect(
      isRepairOverdue(
        repair({
          scheduled_date: '2026-09-24',
          property: { name: 'Anglicka 7', status: 'active', timezone: 'UTC' },
        }),
        lateEvening,
      ),
    ).toBe(false);
  });

  test('not before its day, not on it, not two days after, and never once it is closed', () => {
    const now = new Date('2026-09-26T10:00:00Z');

    expect(isRepairOverdue(repair({ scheduled_date: '2026-09-30' }), now)).toBe(false);
    expect(isRepairOverdue(repair({ scheduled_date: '2026-09-26' }), now)).toBe(false);
    expect(isRepairOverdue(repair({ scheduled_date: '2026-09-24' }), now)).toBe(false);
    expect(isRepairOverdue(repair({ scheduled_date: '2026-09-23' }), now)).toBe(true);
    expect(isRepairOverdue({ ...repair(), status: 'done' }, now)).toBe(false);
  });

  // The owner, 2026-11-26: a task planned ahead does not hang before its day, however early its
  // repair was booked; the read embeds the task's day (`problem:problem_id(due_on)`).
  test('counted from its task’s planned day when that is later', () => {
    const now = new Date('2026-09-26T10:00:00Z');
    const planned = (due_on: string | null) =>
      repair({ scheduled_date: '2026-09-12', problem: { due_on } });

    expect(isRepairOverdue(planned(null), now)).toBe(true);
    expect(isRepairOverdue(planned('2026-09-30'), now)).toBe(false);
    expect(repairTailOf(planned('2026-09-30'), now)).toBeNull();
    expect(repairTailOf(planned('2026-09-24'), now)).toEqual({ days: 2, isOverdue: false });
    expect(isRepairOverdue(planned('2026-09-23'), now)).toBe(true);
    // A planned day earlier than the repair's own counts for nothing.
    const early = repair({ scheduled_date: '2026-09-25', problem: { due_on: '2026-09-01' } });
    expect(repairTailDay(early)).toBe('2026-09-25');
  });

  test('a listing’s badge counts from the planned day, and none while it is ahead', () => {
    const now = new Date('2026-09-26T10:00:00Z');
    const alerts = overdueRepairsByProperty(
      [
        repair({ scheduled_date: '2026-09-12', problem: { due_on: '2026-09-20' } }),
        repair({ property_id: 2, scheduled_date: '2026-09-12', problem: { due_on: '2026-09-28' } }),
      ],
      now,
    );

    expect(alerts.get(1)?.since).toBe('2026-09-20');
    expect(alerts.has(2)).toBe(false);
  });

  test('a repair read before the planned day existed reads as nothing planned', () => {
    const now = new Date('2026-09-26T10:00:00Z');
    const old = repair({ scheduled_date: '2026-09-12' });

    expect(old.problem).toBeNull();
    expect(isRepairOverdue(old, now)).toBe(true);
    expect(repairTailDay(old)).toBe('2026-09-12');
  });
});

describe('the technician is switched off', () => {
  test('when the person on it no longer works here; nobody on it is not that', () => {
    expect(isTechnicianOff(repair())).toBe(false);
    expect(isTechnicianOff(repair({ assignee: { full_name: 'Iva', is_active: false } }))).toBe(
      true,
    );
    expect(isTechnicianOff(repair({ assignee_id: null, assignee: null }))).toBe(false);
  });
});

describe('the overdue repairs of each listing', () => {
  test('since the earliest, with the technicians, and whether one is switched off', () => {
    const now = new Date('2026-09-26T10:00:00Z');
    const alerts = overdueRepairsByProperty(
      [
        repair({ scheduled_date: '2026-09-22' }),
        repair({
          scheduled_date: '2026-09-12',
          assignee_id: IVA,
          assignee: { full_name: 'Iva', is_active: false },
        }),
        repair({ scheduled_date: '2026-09-28' }),
        repair({ property_id: 2, scheduled_date: '2026-09-23', assignee_id: null, assignee: null }),
        // Two days behind: not overdue yet, so the listing carries no badge.
        repair({ property_id: 3, scheduled_date: '2026-09-24' }),
      ],
      now,
    );

    expect(alerts.get(1)).toEqual({
      since: '2026-09-12',
      technicians: [
        { id: IVA, name: 'Iva', isOff: true },
        { id: TECHNICIAN, name: 'Technician 1', isOff: false },
      ],
      isTechnicianOff: true,
    });
    expect(alerts.get(2)).toEqual({ since: '2026-09-23', technicians: [], isTechnicianOff: false });
    expect(alerts.has(3)).toBe(false);
  });

  // A profile without a name is still somebody: the badge must not say nobody.
  test('a switched-off technician without a name is kept, nameless', () => {
    const alerts = overdueRepairsByProperty(
      [repair({ assignee_id: IVA, assignee: { full_name: null, is_active: false } })],
      new Date('2026-09-26T10:00:00Z'),
    );

    expect(alerts.get(1)?.technicians).toEqual([{ id: IVA, name: null, isOff: true }]);
  });
});
