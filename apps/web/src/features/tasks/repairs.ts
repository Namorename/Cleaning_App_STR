import { plannedTail, tailDay, type JobTail } from '@str-ops/shared';

import { todayIn } from '@/lib/format-date';

import { isTaskClosed, type DatedJob, type LiveRepair } from './schema';

/**
 * The one rule of a repair left behind (docs/f10-plan.md, §6). The calendar's
 * badge and chip, and stage 8's dashboard counters, count by these functions,
 * so the rule has no second copy. Its day rule is the section's own
 * (`tailOf`): a repair hangs and is overdue as any job of «Уборки» would be —
 * counted from its own day, but never before its task's planned day (owner,
 * 2026-11-26: `plannedTail`), so a task planned ahead does not hang early.
 */

/** What the rule reads of a repair: its day and zone, and its task's planned day when read. */
export interface RepairJob extends DatedJob {
  problem?: { due_on?: string | null } | null;
}

/** The day a repair hangs from: its own, or its task's planned day when that is later. */
export function repairTailDay(repair: RepairJob): string {
  return tailDay(repair.scheduled_date, repair.problem?.due_on) ?? repair.scheduled_date;
}

/** How long a live repair has hung past `repairTailDay`, in its listing's zone; null while not. */
export function repairTailOf(repair: RepairJob, now: Date = new Date()): JobTail | null {
  if (isTaskClosed(repair)) {
    return null;
  }
  return plannedTail(
    repair.scheduled_date,
    repair.problem?.due_on,
    todayIn(repair.property?.timezone, now),
  );
}

/**
 * Live and hanging OVERDUE_AFTER_DAYS days or more past its day, counted in
 * the listing's own zone. The sweep no longer closes a repair
 * (20260923130000), so one left behind stays live and keeps its day.
 */
export function isRepairOverdue(repair: RepairJob, now: Date = new Date()): boolean {
  return repairTailOf(repair, now)?.isOverdue ?? false;
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
  /** The earliest day an overdue repair of the listing was due (`repairTailDay`). */
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
      since: repairTailDay(repair),
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
