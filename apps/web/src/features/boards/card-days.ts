import type { CardOrder } from '@str-ops/shared';

import { withDayHeadings, type DayEntry } from '@/lib/day-entries';

import type { BoardCard } from './schema';

/** The key of the run of cards with no due date: a `YYYY-MM-DD` is never empty. */
const NO_DUE_DAY = '';

/**
 * A lane's cards, already in their order (`orderCards`), with the day headings of the technicians'
 * board (owner, 2026-11-28: «Линии по дням на досках менеджера»). A card's day is its due date —
 * the only date a manager board's card has. Ordered by due date (the default) a lane already is its
 * days, the earliest first and the newest card first within a day, the cards with no due date last:
 * each day is headed, and so is that last run. Ordered «Новые сверху» a lane is in no day's order,
 * and a heading over every other card would only cut the list: it has none.
 */
export function laneEntries<T extends Pick<BoardCard, 'due_on'>>(
  cards: readonly T[],
  order: CardOrder,
): DayEntry<T>[] {
  return order === 'due'
    ? withDayHeadings(cards, (card) => card.due_on ?? NO_DUE_DAY)
    : cards.map((item) => ({ kind: 'item' as const, item }));
}

/** The day a heading of `laneEntries` stands for: a `YYYY-MM-DD`, or null for no due date. */
export function headingDay(day: string): string | null {
  return day === NO_DUE_DAY ? null : day;
}
