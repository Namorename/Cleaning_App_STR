import type { TaskStatus } from '@str-ops/shared';
import { z } from 'zod';

import type { StaffMember } from '@/features/board/schema';
import { cleaningTaskSchema } from '@/features/tasks/schema';
import {
  daysBetween,
  firstDayOf,
  shiftDay,
  shiftMonth,
  todayDay,
  type DayMark,
} from '@/lib/calendar-month';

/** How a cleaner handed a cleaning back (20261118120000): before starting it, or after. */
export const RELEASE_KINDS = ['declined', 'interrupted'] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

const offPersonSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().nullable().default(null),
    role: z.string().nullable().default(null),
  })
  .nullable()
  .catch(null)
  .default(null);

/**
 * The office's cancel and a cleaner's hand-back, with the names and the words
 * (the computed field `task_offs`, 20261118120000) — the panel's shape. The
 * office's alone: null for anybody else, and on a cleaning that has neither.
 */
export const cleaningOffsSchema = z.object({
  cancelled: z
    .object({
      at: z.string(),
      from: z.string().nullable().default(null),
      by: offPersonSchema,
      reason: z.string().nullable().default(null),
    })
    .nullable()
    .catch(null)
    .default(null),
  released: z
    .object({
      kind: z.enum(RELEASE_KINDS),
      at: z.string(),
      by: offPersonSchema,
      reason: z.string().nullable().default(null),
    })
    .nullable()
    .catch(null)
    .default(null),
});

export type CleaningOffs = z.infer<typeof cleaningOffsSchema>;

/**
 * A cleaning as the office reads it on the phone: the cleaner's row and what
 * only the office is shown beside it. Every key added here is caught and
 * defaulted: a row restored from disk in an older shape still reads, and one a
 * cleaner's read put in a shared cache (`useTask`) reads as «not known».
 */
export const officeTaskSchema = cleaningTaskSchema.extend({
  // The person on it, by name: profiles are open to the office.
  assignee: z
    .object({ full_name: z.string().nullable().default(null) })
    .nullable()
    .catch(null)
    .default(null),
  // Set on a cleaning the office cancelled: the one «Вернуть» returns.
  cancelled_at: z.string().nullable().catch(null).default(null),
  // A cleaner handed it back and nobody has been put on it since.
  release_kind: z.enum(RELEASE_KINDS).nullable().catch(null).default(null),
  offs: cleaningOffsSchema.nullable().catch(null).default(null),
});

export type OfficeTask = z.infer<typeof officeTaskSchema>;

export const officeTaskListSchema = z.array(officeTaskSchema);

/** Days `from` up to `to` (exclusive), both `YYYY-MM-DD`. */
export interface DayRange {
  from: string;
  to: string;
}

/**
 * The most days one read of the office's cleanings covers: two months, more
 * than the six weeks a month grid shows. A wider span is a mistake of the
 * caller, refused before anything is sent (api.ts).
 */
export const MAX_RANGE_DAYS = 62;

export function isRangeAllowed({ from, to }: DayRange): boolean {
  const days = daysBetween(from, to);
  return days > 0 && days <= MAX_RANGE_DAYS;
}

/** The chips of the list's date: today, tomorrow, a week from today, or the day picked in the calendar. */
export type DateChoice = 'today' | 'tomorrow' | 'week' | 'day';

export interface DateFilter {
  choice: DateChoice;
  /** The day picked in the calendar, `YYYY-MM-DD`; kept when another chip is chosen. */
  day: string | null;
}

const WEEK = 7;

/** The days a date filter covers, counted from `today` — the phone's own by default. */
export function rangeOfDate(filter: DateFilter, today: string = todayDay()): DayRange {
  switch (filter.choice) {
    case 'today':
      return { from: today, to: shiftDay(today, 1) };
    case 'tomorrow':
      return { from: shiftDay(today, 1), to: shiftDay(today, 2) };
    case 'week':
      return { from: today, to: shiftDay(today, WEEK) };
    case 'day': {
      const day = filter.day ?? today;
      return { from: day, to: shiftDay(day, 1) };
    }
  }
}

/** A day picked in the calendar, as the list's chips say it: today and tomorrow have their own. */
export function dateOfDay(day: string, today: string = todayDay()): DateFilter {
  if (day === today) {
    return { choice: 'today', day };
  }
  return { choice: day === shiftDay(today, 1) ? 'tomorrow' : 'day', day };
}

/** The day the calendar shows picked for a date filter: a span's first day. */
export function selectedDayOf(filter: DateFilter, today: string = todayDay()): string {
  switch (filter.choice) {
    case 'tomorrow':
      return shiftDay(today, 1);
    case 'day':
      return filter.day ?? today;
    default:
      return today;
  }
}

/** The day picked in the calendar, when it needs a chip of its own — not today, not tomorrow. */
export function pickedDayOf(filter: DateFilter, today: string = todayDay()): string | null {
  const { day } = filter;
  return day === null || day === today || day === shiftDay(today, 1) ? null : day;
}

/** The days of a month, `YYYY-MM`. */
export function rangeOfMonth(month: string): DayRange {
  return { from: firstDayOf(month), to: firstDayOf(shiftMonth(month, 1)) };
}

/** The status chips, in their order. «Все» leaves the cancelled out, as the panel does. */
export const OFFICE_STATUS_FILTERS = [
  'all',
  'unassigned',
  'assigned',
  'in_progress',
  'done',
  'cancelled',
] as const;

export type OfficeStatusFilter = (typeof OFFICE_STATUS_FILTERS)[number];

const STATUSES_OF: Readonly<Record<Exclude<OfficeStatusFilter, 'all'>, readonly TaskStatus[]>> = {
  unassigned: ['unassigned'],
  assigned: ['assigned', 'accepted'],
  in_progress: ['in_progress', 'paused', 'blocked'],
  done: ['done'],
  cancelled: ['cancelled'],
};

export function matchesStatus(task: Pick<OfficeTask, 'status'>, filter: OfficeStatusFilter): boolean {
  return filter === 'all' ? task.status !== 'cancelled' : STATUSES_OF[filter].includes(task.status);
}

export interface OfficeFilter {
  status: OfficeStatusFilter;
  /** A place's key (`placeKey`), or null for every place. */
  place: string | null;
}

export const NO_FILTER: OfficeFilter = { status: 'all', place: null };

/**
 * Which place a cleaning is filtered by: the house, whichever of its rooms the
 * cleaning stands on — a manager looks for «Vinohradska», not for «1 - 2109».
 * The house is the room's parent, or the listing itself.
 */
export function placeKey(task: Pick<OfficeTask, 'property' | 'property_id'>): string {
  const property = task.property ?? null;
  if (property === null) {
    return `#${task.property_id}`;
  }
  return property.parent?.name ?? property.name;
}

export interface PlaceOption {
  key: string;
  count: number;
}

/** The places of the rows read, by name, each with how many of the rows stand there. */
export function placesOf(tasks: readonly OfficeTask[]): PlaceOption[] {
  const counts = tasks.reduce<ReadonlyMap<string, number>>(
    (seen, task) => new Map(seen).set(placeKey(task), (seen.get(placeKey(task)) ?? 0) + 1),
    new Map(),
  );
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function filterOffice(tasks: readonly OfficeTask[], filter: OfficeFilter): OfficeTask[] {
  return tasks.filter(
    (task) =>
      matchesStatus(task, filter.status) && (filter.place === null || placeKey(task) === filter.place),
  );
}

/** A day of the office's list: its heading is the day (features/tasks/section-heading.tsx). */
export interface OfficeDay {
  readonly kind: 'day';
  readonly key: string;
  readonly data: OfficeTask[];
}

/** A section per day, the nearest first; inside a day the server's order (time, then id). */
export function groupOfficeByDay(tasks: readonly OfficeTask[]): OfficeDay[] {
  const days = [...new Set(tasks.map((task) => task.scheduled_date))].sort();
  return days.map((day) => ({
    kind: 'day' as const,
    key: day,
    data: tasks.filter((task) => task.scheduled_date === day),
  }));
}

/** A cleaning waiting for a person: nobody on it, not closed. */
export function isWaiting(task: Pick<OfficeTask, 'status'>): boolean {
  return task.status === 'unassigned';
}

/** What the month grid draws on each day: how many cleanings, and whether one waits for a person. */
export function dayMarks(tasks: readonly OfficeTask[]): Readonly<Record<string, DayMark>> {
  return tasks.reduce<Readonly<Record<string, DayMark>>>((marks, task) => {
    const before = marks[task.scheduled_date];
    return {
      ...marks,
      [task.scheduled_date]: {
        count: (before?.count ?? 0) + 1,
        isAttention: (before?.isAttention ?? false) || isWaiting(task),
      },
    };
  }, {});
}

/** The statuses somebody may still work in: the ones a person can be put on. */
const LIVE: readonly TaskStatus[] = [
  'unassigned',
  'assigned',
  'accepted',
  'in_progress',
  'paused',
  'blocked',
];

/**
 * «Назначить» / «Переназначить»: a cleaning still to be done, not the repair of
 * a task — that one is handed out on its task's screen (assign_problem). The
 * server refuses a closed one (taskClosed). A row read before `problem_id` was
 * asked for (undefined) offers nothing until the screen's own read.
 */
export function canAssignCleaning(task: Pick<OfficeTask, 'status' | 'problem_id'>): boolean {
  return task.problem_id === null && LIVE.includes(task.status);
}

/**
 * Whom «Назначить» offers on a cleaning: the cleaners at work, in the
 * directory's order (by name). The server takes no technician on a cleaning
 * (cleaningNotForTech) and nobody switched off (taskAssigneeInvalid).
 */
export function activeCleaners(staff: readonly StaffMember[]): StaffMember[] {
  return staff.filter((person) => person.is_active && person.role === 'cleaner');
}

/** «Вернуть»: only a cancel the office made; a booking's cancel is the booking's. */
export function canRestoreCleaning(
  task: Pick<OfficeTask, 'status' | 'problem_id' | 'cancelled_at'>,
): boolean {
  return task.problem_id === null && task.status === 'cancelled' && task.cancelled_at !== null;
}
