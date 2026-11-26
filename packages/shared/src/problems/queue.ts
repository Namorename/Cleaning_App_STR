import { jobTail, todayInZone, type JobTail } from '../schedule/job-tail';
import { byUrgencyFirst, problemLevel, type StoredUrgency } from './level';

/**
 * The technicians' queue (owner, 2026-11-26; docs/problem-due-date.md): a task (problem) may carry
 * the day it is to be done (`due_on`, 20261126130000), set by the office. One order for every
 * queue of both apps — the technicians' board in the panel, «Задания» there, the technician's,
 * the head technician's and the manager's lists on the phone:
 *
 * 1. the effective day: the planned day, else the day the task was made (in its listing's zone);
 *    earlier first, so what is planned ahead stands below today's work;
 * 2. the level: critical first, then high, normal, low;
 * 3. the moment it was made: the older first.
 *
 * Pure functions: no React, no DOM.
 */

/** What the queue reads of a task. Fields an older cached row lacks read as nothing planned. */
export interface QueueFacts extends StoredUrgency {
  readonly created_at: string;
  readonly due_on?: string | null;
  readonly property?: { readonly timezone?: string | null } | null;
}

/** The calendar day of an instant in a zone, `YYYY-MM-DD`; the device's day without a zone. */
export function dayOfInstant(instant: string, timeZone: string | null | undefined): string {
  return todayInZone(timeZone, new Date(instant));
}

/** The day a task stands on in the queue: its planned day, else the day it was made. */
export function queueDay(task: QueueFacts): string {
  return task.due_on ?? dayOfInstant(task.created_at, task.property?.timezone);
}

/** For `sort`: the effective day, then the level (critical first), then the older first. */
export function compareQueue(left: QueueFacts, right: QueueFacts): number {
  const day = queueDay(left).localeCompare(queueDay(right));
  if (day !== 0) {
    return day;
  }
  const level = byUrgencyFirst(problemLevel(left), problemLevel(right));
  if (level !== 0) {
    return level;
  }
  return left.created_at.localeCompare(right.created_at);
}

/** The tasks in queue order, a new array. */
export function orderQueue<T extends QueueFacts>(tasks: readonly T[]): T[] {
  return [...tasks].sort(compareQueue);
}

/**
 * The day a live repair's «Висит N дней» and «Просрочено» count from: its own day, but never
 * before the task's planned day — a task planned ahead does not hang before its day, however early
 * its repair was booked (owner, 2026-11-26). Without a repair day, nothing hangs.
 */
export function tailDay(repairDay: string | null, dueOn: string | null | undefined): string | null {
  if (repairDay === null) {
    return null;
  }
  if (dueOn === null || dueOn === undefined) {
    return repairDay;
  }
  return dueOn > repairDay ? dueOn : repairDay;
}

/** The tail of a live repair under the planned day (`jobTail` from `tailDay`). */
export function plannedTail(
  repairDay: string | null,
  dueOn: string | null | undefined,
  today: string,
): JobTail | null {
  const day = tailDay(repairDay, dueOn);
  return day === null ? null : jobTail(day, today);
}

/** How a planned day reads beside a task: today, tomorrow, or the day itself. */
export type PlannedDay =
  | { readonly kind: 'today' }
  | { readonly kind: 'tomorrow' }
  | { readonly kind: 'past'; readonly day: string }
  | { readonly kind: 'later'; readonly day: string };

function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/** The planned day as a label reads it, or null when nothing is planned. */
export function plannedDay(dueOn: string | null | undefined, today: string): PlannedDay | null {
  if (dueOn === null || dueOn === undefined) {
    return null;
  }
  if (dueOn === today) {
    return { kind: 'today' };
  }
  if (dueOn === nextDay(today)) {
    return { kind: 'tomorrow' };
  }
  return dueOn < today ? { kind: 'past', day: dueOn } : { kind: 'later', day: dueOn };
}

/** The office plans a day from yesterday to a year ahead (problem_due_check). */
export const DUE_DAYS_AHEAD = 366;
