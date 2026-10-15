import type { Translate } from './kpi-spec';

/** A value a filter offers: its id and how it reads. */
export interface FilterOption {
  id: string;
  label: string;
}

/** Who and what the filters name: the listings, the people offered, everyone on the team. */
export interface FilterLookups {
  listingNames: readonly FilterOption[];
  people: readonly FilterOption[];
  /** Null while the team loads. */
  staff: readonly FilterOption[] | null;
}

/** A listing named as the filter names it; an id nobody knows stays an id. */
export function listingFilterLabel(id: number, listingNames: readonly FilterOption[]): string {
  return listingNames.find((one) => one.id === String(id))?.label ?? String(id);
}

/**
 * A person named as the filter names her. Somebody no longer on the team (a
 * chart still counts her work) is named as what she is, never by an id; until
 * the team has loaded, nobody can be called a former employee.
 */
export function personFilterLabel(
  id: string,
  people: readonly FilterOption[],
  staff: readonly FilterOption[] | null,
  t: Translate,
): string {
  return (
    people.find((one) => one.id === id)?.label ??
    staff?.find((one) => one.id === id)?.label ??
    (staff === null ? t('panel.analytics.charts.loading') : t('panel.analytics.filters.formerEmployee'))
  );
}
