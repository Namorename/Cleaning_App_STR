import { addDays, daysBetween } from '@/features/calendar/dates';

/**
 * The period of the Analytics page: two listing-local days, both included, as
 * the server's analytics functions take them (20261015110000).
 */
export interface Period {
  from: string;
  to: string;
}

/** The quick choices beside the two dates (owner, 2026-10-14). */
export const PERIOD_PRESETS = ['7d', '30d', '90d', 'thisMonth', 'lastMonth'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/** The longest period the server counts (analytics_guard). */
export const MAX_PERIOD_DAYS = 400;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** The last day of the month `day` is in. */
function monthEnd(day: string): string {
  const [year, month] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** The first day of the month before the one `day` is in. */
function previousMonthStart(day: string): string {
  return monthStart(addDays(monthStart(day), -1));
}

export function presetPeriod(preset: PeriodPreset, today: string): Period {
  switch (preset) {
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'thisMonth':
      return { from: monthStart(today), to: today };
    case 'lastMonth': {
      const from = previousMonthStart(today);
      return { from, to: monthEnd(from) };
    }
  }
}

export function periodDays({ from, to }: Period): number {
  return daysBetween(from, to) + 1;
}

export function isValidPeriod(period: Period): boolean {
  if (!DAY.test(period.from) || !DAY.test(period.to)) {
    return false;
  }
  const days = periodDays(period);
  return Number.isFinite(days) && days >= 1 && days <= MAX_PERIOD_DAYS;
}

/**
 * The period a figure is compared with. A whole calendar month is compared
 * with the whole month before; a month so far (from its first day) with the
 * same days of the month before, cut at that month's end; anything else with
 * as many days right before it.
 */
export function previousPeriod(period: Period): Period {
  const { from, to } = period;
  const startsMonth = from === monthStart(from);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);

  if (startsMonth && sameMonth) {
    const start = previousMonthStart(from);
    const end = monthEnd(start);
    if (to === monthEnd(from)) {
      return { from: start, to: end };
    }
    const sameDay = `${start.slice(0, 7)}-${to.slice(8, 10)}`;
    return { from: start, to: sameDay > end ? end : sameDay };
  }

  const days = periodDays(period);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}
