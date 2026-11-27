/**
 * A list already in the order of its days, with a day's heading before the first item of each
 * new day (owner, 2026-11-27: the day dividers of the technicians' board). Pure: no React, no DOM.
 */

/** A heading before the first item of a day. */
export interface DayHeading<T> {
  readonly kind: 'day';
  /** Unique among the list's entries, for React. */
  readonly key: string;
  /** The day, `YYYY-MM-DD`. */
  readonly day: string;
  /** The day's first item: what the heading reads today's day from (its zone). */
  readonly first: T;
}

/** An item of the list, under its day's heading. */
export interface DayItem<T> {
  readonly kind: 'item';
  readonly item: T;
}

export type DayEntry<T> = DayHeading<T> | DayItem<T>;

/**
 * The items in their own order, each new day headed. A run of items ends where the day changes,
 * or where the list's part changes (`partOf`: the list's live tasks, then its closed ones, each
 * ordered on its own) — so a day the closed part starts on is headed again. The items are never
 * moved: a list out of the order of its days only gets more headings.
 */
export function withDayHeadings<T>(
  items: readonly T[],
  dayOf: (item: T) => string,
  partOf: (item: T) => string = () => '',
): DayEntry<T>[] {
  const entries: DayEntry<T>[] = [];
  const seen = new Map<string, number>();
  let current: string | null = null;
  for (const item of items) {
    const day = dayOf(item);
    const run = `${partOf(item)}:${day}`;
    if (run !== current) {
      const times = seen.get(run) ?? 0;
      seen.set(run, times + 1);
      entries.push({
        kind: 'day',
        key: times === 0 ? `day:${run}` : `day:${run}:${times}`,
        day,
        first: item,
      });
      current = run;
    }
    entries.push({ kind: 'item', item });
  }
  return entries;
}
