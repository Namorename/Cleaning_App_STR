import { todayIn } from '@/lib/format-date';

import type { LiveRepair, TaskStatus } from './schema';

/**
 * The one rule of a repair left behind (docs/f10-plan.md, §6). The calendar's
 * badge and chip, and stage 8's dashboard counters, count by these functions,
 * so the rule has no second copy.
 */

const LIVE: readonly TaskStatus[] = [
  'unassigned',
  'assigned',
  'accepted',
  'in_progress',
  'paused',
  'blocked',
];

interface RepairDay {
  status: TaskStatus;
  scheduled_date: string;
  property?: { timezone?: string | null } | null;
}

/**
 * Live and dated before the listing's own today. The sweep no longer closes a
 * repair (20260923130000), so one left behind stays live and keeps its day.
 */
export function isRepairOverdue(repair: RepairDay, now: Date = new Date()): boolean {
  return (
    LIVE.includes(repair.status) &&
    repair.scheduled_date < todayIn(repair.property?.timezone ?? null, now)
  );
}

/** The person on it no longer works here; nobody on it is not that. */
export function isTechnicianOff(repair: Pick<LiveRepair, 'assignee'>): boolean {
  return repair.assignee !== null && !repair.assignee.is_active;
}

export interface Technician {
  id: string;
  /** Null for a profile without a name: still somebody, not nobody. */
  name: string | null;
  /** No longer works here. */
  isOff: boolean;
}

export interface RepairAlert {
  /** The earliest day an overdue repair of the listing was due. */
  since: string;
  /** The technicians on them, alphabetical, each once. */
  technicians: Technician[];
  isTechnicianOff: boolean;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/** Several alerts as one: a closed group shows its rooms' and parts' (§3). */
export function mergeRepairAlerts(alerts: readonly RepairAlert[]): RepairAlert | undefined {
  if (alerts.length === 0) {
    return undefined;
  }
  const byId = new Map<string, Technician>();
  for (const person of alerts.flatMap((alert) => alert.technicians)) {
    const known = byId.get(person.id);
    byId.set(person.id, { ...person, isOff: (known?.isOff ?? false) || person.isOff });
  }
  return {
    since: alerts.map((alert) => alert.since).sort()[0],
    technicians: [...byId.values()].sort((a, b) => collator.compare(a.name ?? '', b.name ?? '')),
    isTechnicianOff: alerts.some((alert) => alert.isTechnicianOff),
  };
}

/** The overdue repairs of each listing, by property id. */
export function overdueRepairsByProperty(
  repairs: readonly LiveRepair[],
  now: Date = new Date(),
): Map<number, RepairAlert> {
  const byProperty = new Map<number, RepairAlert[]>();
  for (const repair of repairs.filter((one) => isRepairOverdue(one, now))) {
    const alert: RepairAlert = {
      since: repair.scheduled_date,
      technicians:
        repair.assignee_id === null || repair.assignee === null
          ? []
          : [
              {
                id: repair.assignee_id,
                name: repair.assignee.full_name,
                isOff: isTechnicianOff(repair),
              },
            ],
      isTechnicianOff: isTechnicianOff(repair),
    };
    byProperty.set(repair.property_id, [...(byProperty.get(repair.property_id) ?? []), alert]);
  }
  return new Map(
    [...byProperty].map(([id, alerts]) => [id, mergeRepairAlerts(alerts) as RepairAlert]),
  );
}
