import { INTL_LOCALES, isSupportedLanguage } from '../i18n';

/**
 * One order for the day lists of both apps (owner, 2026-11-27): the technicians' tasks
 * (problems) and the cleanings (tasks) stand
 *
 * 1. by their day, in the direction each list already had (a queue the earlier day first, a
 *    history the later first);
 * 2. within a day by the name of the property as the list shows it: the interface language's
 *    rules, case and accents aside, numbers by their value («Apt 2» before «Apt 10»);
 * 3. a row with no property last in its day;
 * 4. then, between rows of one property, by the caller's own tie-break.
 *
 * Pure functions: no React, no DOM.
 */

/** Which day comes first. */
export type DayDirection = 'earlier-first' | 'later-first';

export interface DayPlaceOrder<T> {
  /** The day a row stands on, `YYYY-MM-DD`. */
  readonly day: (row: T) => string;
  /** The property's name as the row shows it; null, undefined or blank when it has none. */
  readonly place: (row: T) => string | null | undefined;
  /** The order of two rows of one day and one property. */
  readonly then?: (left: T, right: T) => number;
  /** Earlier days first unless said otherwise. */
  readonly days?: DayDirection;
  /** The interface language (`en`, `ru`, `cs`) or any BCP 47 tag; the device's own without one. */
  readonly language?: string | null;
}

// Building a collator costs far more than using one, and a list asks for one on every render.
const collators = new Map<string, Intl.Collator>();

function localeOf(language: string | null | undefined): string | undefined {
  if (language === null || language === undefined || language.trim() === '') {
    return undefined;
  }
  const code = language.split('-')[0].toLowerCase();
  return isSupportedLanguage(code) ? INTL_LOCALES[code] : language;
}

/**
 * The comparison of property names in a language: its own alphabet (Czech «ch» after «h»), case
 * and accents aside, and the numbers inside a name by their value, so «3-302» stands before
 * «3-3008» and «Apt 2» before «Apt 10».
 */
export function placeCollator(language?: string | null): Intl.Collator {
  const locale = localeOf(language);
  const key = locale ?? '';
  const known = collators.get(key);
  if (known !== undefined) {
    return known;
  }
  let made: Intl.Collator;
  try {
    made = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  } catch {
    // A tag the engine refuses: the device's own rules rather than no order at all.
    made = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  }
  collators.set(key, made);
  return made;
}

function shownPlace(place: string | null | undefined): string | null {
  if (place === null || place === undefined) {
    return null;
  }
  const trimmed = place.trim();
  return trimmed === '' ? null : trimmed;
}

/** Two shown names in the language's order; a row with no property after every named one. */
function byPlace(left: string | null, right: string | null, collator: Intl.Collator): number {
  if (left === null || right === null) {
    return Number(left === null) - Number(right === null);
  }
  return collator.compare(left, right);
}

/** For `sort` of two property names as shown: the language's order, a missing or blank one last. */
export function comparePlaces(
  left: string | null | undefined,
  right: string | null | undefined,
  language?: string | null,
): number {
  return byPlace(shownPlace(left), shownPlace(right), placeCollator(language));
}

/** Plain order of two ISO strings (days, instants, times): no locale rules, no allocation. */
export function byIsoText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/** Two optional ISO strings, the earlier first and a missing one after both. */
export function byIsoTextMissingLast(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const hasLeft = left !== null && left !== undefined;
  const hasRight = right !== null && right !== undefined;
  if (!hasLeft || !hasRight) {
    return Number(!hasLeft) - Number(!hasRight);
  }
  return byIsoText(left, right);
}

/**
 * The rows by day, then by property, then by the caller's tie-break; a new array. Each row's day
 * and name are read once — a day may come through Intl, too dear to repeat in every comparison
 * of a list of hundreds.
 */
export function orderByDayAndPlace<T>(rows: readonly T[], order: DayPlaceOrder<T>): T[] {
  const collator = placeCollator(order.language);
  const sign = order.days === 'later-first' ? -1 : 1;
  const then = order.then ?? (() => 0);
  return rows
    .map((row) => ({ row, day: order.day(row), place: shownPlace(order.place(row)) }))
    .sort(
      (left, right) =>
        sign * byIsoText(left.day, right.day) ||
        byPlace(left.place, right.place, collator) ||
        then(left.row, right.row),
    )
    .map(({ row }) => row);
}

/** What the order of cleanings reads of a row. Fields an older cached row lacks read as unknown. */
export interface CleaningOrderFacts {
  readonly scheduled_date: string;
  /** The start of its window (`HH:MM[:SS]`), the planned time. */
  readonly time_from?: string | null;
  readonly created_at?: string | null;
}

export interface CleaningOrderOptions<T> {
  /** The property's name as the row shows it. */
  readonly place: (row: T) => string | null | undefined;
  readonly language?: string | null;
  readonly days?: DayDirection;
  /** The day a row stands on; its scheduled day unless said otherwise. */
  readonly day?: (row: T) => string;
}

/** Between cleanings of one day and property: the earlier start, then the one made first. */
export function compareCleaningTimes(left: CleaningOrderFacts, right: CleaningOrderFacts): number {
  return (
    byIsoTextMissingLast(left.time_from, right.time_from) ||
    byIsoTextMissingLast(left.created_at, right.created_at)
  );
}

/** Cleanings by day, then property, then the start of the window, then the one made first. */
export function orderCleanings<T extends CleaningOrderFacts>(
  rows: readonly T[],
  options: CleaningOrderOptions<T>,
): T[] {
  return orderByDayAndPlace(rows, {
    day: options.day ?? ((row) => row.scheduled_date),
    place: options.place,
    then: compareCleaningTimes,
    days: options.days,
    language: options.language,
  });
}
