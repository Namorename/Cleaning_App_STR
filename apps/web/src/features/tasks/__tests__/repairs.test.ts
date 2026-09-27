import { describe, expect, test } from 'vitest';

import { isRepairOverdue, isTechnicianOff, overdueRepairsByProperty } from '../repairs';
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

  test('when its day is before the listing’s own today', () => {
    expect(isRepairOverdue(repair({ scheduled_date: '2026-09-26' }), lateEvening)).toBe(true);
    expect(
      isRepairOverdue(
        repair({
          scheduled_date: '2026-09-26',
          property: { name: 'Anglicka 7', status: 'active', timezone: 'UTC' },
        }),
        lateEvening,
      ),
    ).toBe(false);
  });

  test('not on its day, not after, and never once it is closed', () => {
    const now = new Date('2026-09-26T10:00:00Z');

    expect(isRepairOverdue(repair({ scheduled_date: '2026-09-26' }), now)).toBe(false);
    expect(isRepairOverdue(repair({ scheduled_date: '2026-09-30' }), now)).toBe(false);
    expect(isRepairOverdue({ ...repair(), status: 'done' }, now)).toBe(false);
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
        repair({ property_id: 2, scheduled_date: '2026-09-25', assignee_id: null, assignee: null }),
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
    expect(alerts.get(2)).toEqual({ since: '2026-09-25', technicians: [], isTechnicianOff: false });
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
