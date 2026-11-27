import { propertyPathOf } from '../property-path';
import {
  byIsoText,
  comparePlaces,
  orderByDayAndPlace,
  type DayDirection,
} from '../schedule/day-place-order';
import { jobTail, todayInZone, type JobTail } from '../schedule/job-tail';
import { byUrgencyFirst, problemLevel, type StoredUrgency } from './level';

/**
 * The technicians' queue (owner, 2026-11-26 and 2026-11-27; docs/problem-due-date.md): a task
 * (problem) may carry the day it is to be done (`due_on`, 20261126130000), set by the office. One
 * order for every queue of both apps — the technicians' board in the panel, «Задания» there, the
 * technician's, the head technician's and the manager's lists on the phone:
 *
 * 1. the effective day: on a board, whose card shows the technician's day, the day of the live
 *    work (owner, 2026-11-27: «Задания не отсортированы»); else the planned day, else the day the
 *    task was made (in its listing's zone); earlier first, so what is planned ahead stands below
 *    today's work;
 * 2. the property, by its name as the list shows it (schedule/day-place-order.ts); a task with no
 *    property last in its day;
 * 3. the level: critical first, then high, normal, low;
 * 4. the moment it was made: the older first.
 *
 * Pure functions: no React, no DOM.
 */

/** What the queue reads of a task's property; an older cached row may lack any of it. */
export interface QueueProperty {
  readonly timezone?: string | null;
  readonly name?: string | null;
  readonly hostaway_unit_id?: number | null;
  readonly parent?: { readonly name: string } | null;
}

/** What the queue reads of a task. Fields an older cached row lacks read as nothing planned. */
export interface QueueFacts extends StoredUrgency {
  readonly created_at: string;
  readonly due_on?: string | null;
  readonly property?: QueueProperty | null;
}

/** How a list asks for the queue's order. */
export interface QueueOrderOptions<T> {
  /** The interface language, for the order of the property names. */
  readonly language?: string | null;
  /** The property's name as the list shows it; the house and the room by default. */
  readonly place?: (task: T) => string | null | undefined;
  /** Earlier days first unless said otherwise. */
  readonly days?: DayDirection;
  /**
   * The day of the task's live work, for a list whose row shows it (a board card: the technician
   * and the day); it leads over the planned day and the day made. Without it, or without work,
   * the task stands on those as before.
   */
  readonly workDay?: (task: T) => string | null | undefined;
}

/** The name a task's property is shown by: the house, and the room inside it when it is one. */
export function queuePlace(task: QueueFacts): string | null {
  const property = task.property ?? null;
  const name = property?.name ?? null;
  if (property === null || name === null) {
    return null;
  }
  return propertyPathOf({
    name,
    hostaway_unit_id: property.hostaway_unit_id,
    parent: property.parent,
  });
}

/** The calendar day of an instant in a zone, `YYYY-MM-DD`; the device's day without a zone. */
export function dayOfInstant(instant: string, timeZone: string | null | undefined): string {
  return todayInZone(timeZone, new Date(instant));
}

/**
 * The day a task stands on in the queue: the day of its live work when the list shows it, else its
 * planned day, else the day it was made.
 */
export function queueDay(task: QueueFacts, workDay?: string | null): string {
  return workDay ?? task.due_on ?? dayOfInstant(task.created_at, task.property?.timezone);
}

/** Between tasks of one day and property: the level (critical first), then the older first. */
export function compareLevelThenAge(left: QueueFacts, right: QueueFacts): number {
  const level = byUrgencyFirst(problemLevel(left), problemLevel(right));
  return level !== 0 ? level : byIsoText(left.created_at, right.created_at);
}

/**
 * The tasks in queue order, a new array: the day, the property, the level, the older first. Each
 * task's day and name are worked out once (orderByDayAndPlace).
 */
export function orderQueue<T extends QueueFacts>(
  tasks: readonly T[],
  options: QueueOrderOptions<T> = {},
): T[] {
  const workDay = options.workDay;
  return orderByDayAndPlace(tasks, {
    day: workDay === undefined ? (task) => queueDay(task) : (task) => queueDay(task, workDay(task)),
    place: options.place ?? queuePlace,
    then: compareLevelThenAge,
    days: options.days,
    language: options.language,
  });
}

/**
 * How a history of tasks is asked for: the instant each row counts by — the moment it was made
 * by default, its resolution in «Выполнено» — and the property's name as the list shows it.
 */
export interface HistoryOrderOptions<T> {
  readonly language?: string | null;
  readonly place?: (task: T) => string | null | undefined;
  readonly at?: (task: T) => string;
}

/**
 * Closed tasks and archives, newest first as they were read: the later day of the row's instant
 * first (in its listing's zone), then the property, the level (critical first), then the newer
 * instant first, as before. A list read in pages of the newest first keeps its pages: a later
 * page only adds rows of the same or earlier days.
 */
export function orderTaskHistory<T extends QueueFacts>(
  tasks: readonly T[],
  options: HistoryOrderOptions<T> = {},
): T[] {
  const at = options.at ?? ((task: T) => task.created_at);
  return orderByDayAndPlace(tasks, {
    day: (task) => dayOfInstant(at(task), task.property?.timezone),
    place: options.place ?? queuePlace,
    then: (left, right) =>
      byUrgencyFirst(problemLevel(left), problemLevel(right)) || byIsoText(at(right), at(left)),
    days: 'later-first',
    language: options.language,
  });
}

/** For `sort` of two tasks: the queue's order (orderQueue), earlier days first. */
export function compareQueue(
  left: QueueFacts,
  right: QueueFacts,
  language?: string | null,
): number {
  return (
    byIsoText(queueDay(left), queueDay(right)) ||
    comparePlaces(queuePlace(left), queuePlace(right), language) ||
    compareLevelThenAge(left, right)
  );
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
