import { isLongList } from '@/components/multi-select-filter';

import type { AnalyticsFilters } from './schema';

/**
 * A choice that ticks every value a long filter offers narrows nothing, and
 * is read as "all" — the empty list every function and the address already
 * take for it (owner, 2026-10-21). «Select all» ticks every box in sight; the
 * screen keeps the ticks, while the address, the server, the charts and the
 * chips are told "all": the link stays short, the request carries no list of
 * ids, and a listing added tomorrow is counted as it would be with no filter.
 * A short list has no such button and keeps what it always meant.
 */
export function wholeAsAll<T>(selected: readonly T[], offered: readonly T[]): readonly T[] {
  if (selected.length === 0 || !isLongList(offered.length)) {
    return selected;
  }
  const chosen = new Set(selected);
  return offered.every((one) => chosen.has(one)) ? [] : selected;
}

/** What the two long filters offer, before the archived switch has its say. */
export interface FilterChoices {
  listings: readonly { id: number; isArchived: boolean }[];
  /** The people who clean and repair. */
  personIds: readonly string[];
}

/** The listings the filter offers: the archived ones too, unless the switch hides them. */
export function offeredListingIds(choices: FilterChoices, hideArchived: boolean): number[] {
  return choices.listings
    .filter((listing) => !(hideArchived && listing.isArchived))
    .map((listing) => listing.id);
}

/** The filters as the page acts on them: a listing or person list ticked whole is "all". */
export function wholeListsAsAll(filters: AnalyticsFilters, choices: FilterChoices): AnalyticsFilters {
  const propertyIds = wholeAsAll(
    filters.propertyIds,
    offeredListingIds(choices, filters.hideArchived),
  );
  const personIds = wholeAsAll(filters.personIds, choices.personIds);
  return propertyIds === filters.propertyIds && personIds === filters.personIds
    ? filters
    : { ...filters, propertyIds, personIds };
}
