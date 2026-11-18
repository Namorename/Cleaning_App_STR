/**
 * The calendar as the screens write it: a month as `YYYY-MM`, a day as
 * `YYYY-MM-DD` — the shape of `scheduled_date`. Plain arithmetic on the
 * phone's own calendar, never an instant: a day read as midnight UTC is the
 * day before to anyone west of Greenwich (features/tasks/format.ts).
 */

const MONTH = /^(\d{4})-(\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A week of the grid: Monday first. */
export const WEEK_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** What a day of a month grid holds: how many things, and whether one of them needs somebody. */
export interface DayMark {
  count: number;
  isAttention?: boolean;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function asMonth(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function asDay(date: Date): string {
  return `${asMonth(date)}-${pad(date.getDate())}`;
}

/** The year and the month (1–12) of `YYYY-MM`; anything else is a mistake of the caller. */
function monthParts(month: string): readonly [number, number] {
  const match = MONTH.exec(month);
  if (match === null) {
    throw new RangeError(`Not a month: ${month}`);
  }
  return [Number(match[1]), Number(match[2])];
}

/** A day as local midnight of that day. */
export function dayDate(day: string): Date {
  const match = DAY.exec(day);
  if (match === null) {
    throw new RangeError(`Not a day: ${day}`);
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function isMonth(value: string): boolean {
  return MONTH.test(value);
}

/** The phone's calendar date, `YYYY-MM-DD`. */
export function todayDay(now: Date = new Date()): string {
  return asDay(now);
}

/** The month a day is in. */
export function monthOf(day: string): string {
  return asMonth(dayDate(day));
}

/** The month `count` months after `month`, or before it when negative. */
export function shiftMonth(month: string, count: number): string {
  const [year, index] = monthParts(month);
  return asMonth(new Date(year, index - 1 + count, 1));
}

/** The day `count` days after `day`, or before it when negative. */
export function shiftDay(day: string, count: number): string {
  const date = dayDate(day);
  return asDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + count));
}

/** Whole days from `from` to `to`; a change of the clocks in between counts for nothing. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayDate(to).getTime() - dayDate(from).getTime()) / MS_PER_DAY);
}

export function firstDayOf(month: string): string {
  monthParts(month);
  return `${month}-01`;
}

export function daysInMonth(month: string): number {
  const [year, index] = monthParts(month);
  return new Date(year, index, 0).getDate();
}

/**
 * The weeks of a month, Monday first: rows of seven, a place before the
 * first day and after the last left null. Four to six rows.
 */
export function monthWeeks(month: string): readonly (readonly (string | null)[])[] {
  const [year, index] = monthParts(month);
  // getDay() counts from Sunday; the grid from Monday.
  const lead = (new Date(year, index - 1, 1).getDay() + WEEK_DAYS - 1) % WEEK_DAYS;
  const days = Array.from({ length: daysInMonth(month) }, (_, offset) => `${month}-${pad(offset + 1)}`);
  const filled = [...Array.from({ length: lead }, () => null), ...days];
  const tail = (WEEK_DAYS - (filled.length % WEEK_DAYS)) % WEEK_DAYS;
  const cells: readonly (string | null)[] = [...filled, ...Array.from({ length: tail }, () => null)];
  return Array.from({ length: cells.length / WEEK_DAYS }, (_, week) =>
    cells.slice(week * WEEK_DAYS, (week + 1) * WEEK_DAYS),
  );
}
