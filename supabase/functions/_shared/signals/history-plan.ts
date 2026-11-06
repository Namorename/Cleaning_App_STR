/**
 * Which weeks and months the reading of past reviews still owes
 * (docs/property-intelligence-plan.md §4.4). Plain days, no clock and no PMS.
 *
 * - The window is N calendar months with the present one, so twelve months never
 *   reach further back than twelve months.
 * - A week is a Monday to a Sunday by the day the guest left. It is read newest
 *   first, once 30 days have passed since its end: Booking's p90 of a review's
 *   lag is 27 days, and a week read earlier would stay short for good.
 * - Past the texts' line there is nothing to read: from there the stream reads. Unless
 *   the reading follows (history_follow): then the weeks go on, and only what has
 *   settled is owed, so a reading that has caught up counts as done.
 * - A listing younger than the window starts at its own birth.
 */

export const HISTORY_SETTLE_DAYS = 30;
/** Failed attempts at a week in two days after which the reading moves on: money must not go round in a circle. */
export const HISTORY_MAX_ATTEMPTS = 3;
const SLICE_DAYS = 7;
const DAY_MS = 86_400_000;

export interface HistorySlice {
  /** A Monday. What the journal and the labels know the week by. */
  readonly start: string;
  /** Its Sunday. */
  readonly end: string;
}

export interface HistoryMonth {
  /** Its first day. */
  readonly start: string;
  readonly end: string;
}

export interface HistoryPlanInput {
  /** `YYYY-MM-DD`. */
  readonly today: string;
  readonly depthMonths: number;
  /** The texts' line as a day, or null while texts never went on. */
  readonly line: string | null;
  /** The weeks this version has closed. */
  readonly done: readonly string[];
  /** A week → its attempts of the last two days that did not close it. */
  readonly stuck?: Readonly<Record<string, number>>;
  /** The reading goes on past the line, week by week. */
  readonly follow?: boolean;
}

export interface HistoryPlan {
  /** The first day of the window. */
  readonly from: string;
  readonly weeksTotal: number;
  /** Open weeks, those still settling among them. */
  readonly weeksLeft: number;
  /** The newest settled open week not stuck, or null. */
  readonly next: HistorySlice | null;
  /** The window's months, newest first. */
  readonly months: readonly HistoryMonth[];
}

function toTime(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function toDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return toDay(toTime(day) + days * DAY_MS);
}

/** The Monday of a day's week. */
export function mondayOf(day: string): string {
  const weekday = new Date(toTime(day)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** The first day of the month `monthsBack` before a day's month. */
export function monthStart(day: string, monthsBack = 0): string {
  const at = new Date(toTime(day));
  return toDay(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - monthsBack, 1));
}

function monthEnd(start: string): string {
  return addDays(monthStart(addDays(start, 31)), -1);
}

/** The window's first day: `depthMonths` calendar months with the present one. */
export function historyFrom(today: string, depthMonths: number): string {
  return monthStart(today, Math.max(depthMonths, 1) - 1);
}

/** The first day a listing is read from: the window's, or its birth when that is later. */
export function floorOf(from: string, bornOn: string | null | undefined): string {
  return bornOn !== null && bornOn !== undefined && bornOn > from ? bornOn : from;
}

/** Every week of the window, oldest first. */
function weeksOf(from: string, today: string, line: string | null): HistorySlice[] {
  const limit = line !== null && line < today ? line : today;
  const weeks: HistorySlice[] = [];
  for (let start = mondayOf(from); start <= limit; start = addDays(start, SLICE_DAYS)) {
    if (line === null || start < line) {
      weeks.push({ start, end: addDays(start, SLICE_DAYS - 1) });
    }
  }
  return weeks;
}

export function planHistory(input: HistoryPlanInput): HistoryPlan {
  const { today, depthMonths, line, done, stuck = {}, follow = false } = input;
  const from = historyFrom(today, depthMonths);
  const closed = new Set(done);
  const isSettled = (week: HistorySlice): boolean => addDays(week.end, HISTORY_SETTLE_DAYS) <= today;
  const all = weeksOf(from, today, follow ? null : line);
  const weeks = follow ? all.filter(isSettled) : all;
  const open = weeks.filter((week) => !closed.has(week.start));
  const settled = open.filter((week) =>
    isSettled(week) && (stuck[week.start] ?? 0) < HISTORY_MAX_ATTEMPTS
  );

  const months: HistoryMonth[] = [];
  for (let back = 0; monthStart(today, back) >= from; back += 1) {
    const start = monthStart(today, back);
    months.push({ start, end: monthEnd(start) });
  }

  return {
    from,
    weeksTotal: weeks.length,
    weeksLeft: open.length,
    next: settled.at(-1) ?? null,
    months,
  };
}

/**
 * The next month of stays to read, or null: a month never read, the newest
 * first; the present month and the one before it again once a day, since stays
 * still end in them.
 */
export function nextStayMonth(
  months: readonly HistoryMonth[],
  doneAt: Readonly<Record<string, string>>,
  today: string,
): HistoryMonth | null {
  const live = months.slice(0, 2);
  return months.find((month) => {
    const at = doneAt[month.start];
    if (at === undefined) {
      return true;
    }
    return live.includes(month) && at.slice(0, 10) < today;
  }) ?? null;
}

/** A week or a month as the window a PMS is asked for: `until` not included. */
export function windowOf(slice: { readonly start: string; readonly end: string }): {
  since: Date;
  until: Date;
} {
  return { since: new Date(toTime(slice.start)), until: new Date(toTime(addDays(slice.end, 1))) };
}
