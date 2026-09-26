/**
 * The calendar's days (docs/f10-plan.md, 7.2).
 *
 * A day is an ISO date, `YYYY-MM-DD`, and never an instant: a booking's
 * arrival is a calendar date at the listing, whatever the manager's browser
 * says the time is. The arithmetic runs in UTC so no daylight-saving change
 * can make a day 23 hours long and skip it.
 */

/** How many days the window shows at once — the controls of A.17. */
export const DEPTHS = [1, 3, 7, 15, 30] as const;
export type Depth = (typeof DEPTHS)[number];

export const DEFAULT_DEPTH: Depth = 7;

export function isDepth(value: unknown): value is Depth {
  return typeof value === 'number' && (DEPTHS as readonly number[]).includes(value);
}

const DAY_MS = 86_400_000;

function toUtc(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

function fromUtc(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(day: string, amount: number): string {
  return fromUtc(toUtc(day) + amount * DAY_MS);
}

/** The days of the window, first to last. */
export function windowDays(start: string, depth: Depth): string[] {
  return Array.from({ length: depth }, (_, at) => addDays(start, at));
}

/** The window opens the day before today: yesterday's departures still matter. */
export function defaultStart(today: string): string {
  return addDays(today, -1);
}

/**
 * The calendar months the window touches, `YYYY-MM` — what the data is keyed
 * by, so the arrows reuse what they have already read (§1, «Окно — месяцами»).
 */
export function monthsOf(days: readonly string[]): string[] {
  return [...new Set(days.map((day) => day.slice(0, 7)))];
}

/** How many days `day` is after `first`; negative before it. */
export function daysBetween(first: string, day: string): number {
  return Math.round((toUtc(day) - toUtc(first)) / DAY_MS);
}

function shiftMonth(month: string, amount: number): string {
  const [year, number] = month.split('-').map(Number);
  return fromUtc(Date.UTC(year, number - 1 + amount, 1)).slice(0, 7);
}

/** A month as a half-open range of days: its first day up to the next month's. */
export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
}

/** The month before the window and the one after: the next arrow reaches them. */
export function neighbourMonths(months: readonly string[]): string[] {
  if (months.length === 0) {
    return [];
  }
  return [shiftMonth(months[0], -1), shiftMonth(months[months.length - 1], 1)];
}

/**
 * The width of a day column, by depth. A week reads a chip in full (about
 * 130 px, §4); a month shows a dot per chip in about 30 px, and scrolls
 * sideways only when thirty of those do not fit.
 */
export const DAY_WIDTH: Readonly<Record<Depth, number>> = {
  1: 320,
  3: 200,
  7: 130,
  15: 64,
  30: 32,
};

const utcFormat = (locale: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });

/** A column's heading: the weekday and the date. */
export function dayLabel(day: string, locale: string, depth: Depth): string {
  return utcFormat(
    locale,
    depth >= 15 ? { day: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' },
  ).format(toUtc(day));
}

/** The whole date, for a screen reader and a tooltip. */
export function fullDayLabel(day: string, locale: string): string {
  return utcFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(toUtc(day));
}

/** The window's first and last day, as the header shows them. */
export function rangeLabel(days: readonly string[], locale: string): string {
  if (days.length === 0) {
    return '';
  }
  const format = utcFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return format.formatRange(toUtc(days[0]), toUtc(days[days.length - 1]));
}
