import { addDays, daysBetween } from '@/features/calendar/dates';
import { isProblemArchived, isProblemClosed, type Problem } from '@/features/problems/schema';
import { isInTab, type SupplyRequest } from '@/features/supplies/schema';
import { isRepairOverdue, isTechnicianOff } from '@/features/tasks/repairs';
import {
  isTaskClosed,
  type CalendarTask,
  type LiveRepair,
  type TaskType,
} from '@/features/tasks/schema';
import { todayIn, todayIso } from '@/lib/format-date';

/**
 * The dashboard's figures (docs/dashboard-plan.md): pure functions over what
 * the sections already read, judged at `now`. A task's today is its
 * listing's own, as the server's rules count it (`todayIn`).
 */

/** «Без исполнителя» looks this many days ahead, today included (owner, 2026-09-29). */
export const UNASSIGNED_DAYS = 7;

/**
 * How often an open dashboard reads and judges again (owner, 2026-09-30).
 * TanStack also reads again when the tab comes back, and never while it is in
 * the background, so a panel left open costs the server nothing.
 */
export const REFRESH_MS = 60_000;

/** A day's cleanings: the cleaning after a stay and the one during it. */
const CLEANING_TYPES: readonly TaskType[] = ['cleaning', 'midstay'];

type DayTask = Pick<
  CalendarTask,
  'type' | 'status' | 'scheduled_date' | 'assignee_id' | 'property'
>;

export interface DashboardWindow {
  from: string;
  /** Exclusive. */
  to: string;
}

/**
 * The days the tasks are read for: the week ahead by the browser's day, a day
 * wider at each end — a listing's own today can be the browser's yesterday or
 * tomorrow.
 */
export function dashboardWindow(now: Date = new Date()): DashboardWindow {
  const today = todayIso(now);
  return { from: addDays(today, -1), to: addDays(today, UNASSIGNED_DAYS + 1) };
}

/** How many days after its listing's today a task stands; negative before it. */
function daysAhead(task: DayTask, now: Date): number {
  return daysBetween(todayIn(task.property?.timezone, now), task.scheduled_date);
}

export interface CleaningsToday {
  total: number;
  done: number;
}

/**
 * Today's cleanings, the mid-stay ones included, and how many are done. The
 * cancelled and the expired are not a day's work.
 */
export function cleaningsToday(tasks: readonly DayTask[], now: Date = new Date()): CleaningsToday {
  const today = tasks.filter(
    (task) =>
      CLEANING_TYPES.includes(task.type) &&
      (task.status === 'done' || !isTaskClosed(task)) &&
      daysAhead(task, now) === 0,
  );
  return { total: today.length, done: today.filter((task) => task.status === 'done').length };
}

export interface UnassignedAhead {
  week: number;
  today: number;
  tomorrow: number;
}

/**
 * The live tasks of every kind nobody holds, from today through the sixth day
 * on (owner, 2026-09-30): an inspection nobody was given is noticed by nobody,
 * and a repair without a technician counts nowhere else until its day passes.
 * What is already past its day is not here: a repair of that kind is overdue.
 */
export function unassignedAhead(
  tasks: readonly DayTask[],
  now: Date = new Date(),
): UnassignedAhead {
  const ahead = tasks
    .filter((task) => !isTaskClosed(task) && task.assignee_id === null)
    .map((task) => daysAhead(task, now))
    .filter((days) => days >= 0 && days < UNASSIGNED_DAYS);
  return {
    week: ahead.length,
    today: ahead.filter((days) => days === 0).length,
    tomorrow: ahead.filter((days) => days === 1).length,
  };
}

/** The tasks the board still shows: neither closed nor archived. */
export function openProblemCount(
  problems: readonly Pick<Problem, 'status' | 'archived_at'>[],
): number {
  return problems.filter((problem) => !isProblemClosed(problem) && !isProblemArchived(problem))
    .length;
}

/** The requests of the «Новые» tab. */
export function newSupplyCount(requests: readonly Pick<SupplyRequest, 'status'>[]): number {
  return requests.filter((request) => isInTab(request, 'new')).length;
}

/** A repair left behind, and which of the two signals it gives — one or both. */
export interface StuckRepair {
  repair: LiveRepair;
  isOverdue: boolean;
  isTechnicianOff: boolean;
}

function byDayThenId(a: StuckRepair, b: StuckRepair): number {
  if (a.repair.scheduled_date !== b.repair.scheduled_date) {
    return a.repair.scheduled_date < b.repair.scheduled_date ? -1 : 1;
  }
  return a.repair.id < b.repair.id ? -1 : a.repair.id > b.repair.id ? 1 : 0;
}

/**
 * The live repairs somebody has to chase, oldest first. The sweep no longer
 * closes a repair (20260923130000), so these two signals replace the one that
 * went: the day has passed, or the technician on it no longer works here. The
 * rule is `repairs.ts`, the calendar's own — there is no second copy of it.
 */
export function stuckRepairs(
  repairs: readonly LiveRepair[],
  now: Date = new Date(),
): StuckRepair[] {
  return repairs
    .map((repair) => ({
      repair,
      isOverdue: isRepairOverdue(repair, now),
      isTechnicianOff: isTechnicianOff(repair),
    }))
    .filter((one) => one.isOverdue || one.isTechnicianOff)
    .sort(byDayThenId);
}

export interface RepairCounts {
  overdue: number;
  technicianOff: number;
}

/** The two counters; a repair that gives both signals is in both. */
export function repairCounts(stuck: readonly StuckRepair[]): RepairCounts {
  return {
    overdue: stuck.filter((one) => one.isOverdue).length,
    technicianOff: stuck.filter((one) => one.isTechnicianOff).length,
  };
}
